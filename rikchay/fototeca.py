"""La Fototeca: las fotografías de la entidad en un solo lugar (2026-10-06).

Edison: «contar con una opción para subir fotografías originales y gestionarlas
desde el propio sistema: administración, organización, edición y otros procesos
[…] para la Semana de Representación, estados, publicaciones, informes».

Reglas del módulo:
  - el ORIGINAL se guarda una vez y NUNCA se modifica; lo identifica su SHA-256 (subir dos veces
    la misma foto no la duplica: se informa y se reutiliza la que ya estaba). Desde la Mediateca
    central (2026-10-19) se llama por la fecha de la toma, en una carpeta por año:
    `<MEDIATECA_DIR>/2026/20261018_182530.jpg` (`_2`, `_3`… si coincide); los activos de marca,
    `marca/<categoría>/<nombre>` (`nombre_marca`). Las tablas viven en la base propia
    (rikchay/modelos.py);
  - la edición es NO destructiva: `ajustes` (girar, voltear, enderezar, recortar,
    brillo, contraste, saturación) se aplica al servir la vista y al exportar.
    Los derivados (miniatura, vista, exportaciones) viven en `cache/` y su nombre
    lleva la huella de los ajustes: cambiar un ajuste crea otro archivo, nunca
    sirve uno viejo;
  - la papelera es un estado (`eliminada_en`); no hay borrado físico por la API;
  - también guarda VIDEOS (mp4, mov, webm; 2026-10-06), con la misma regla del
    original único por SHA-256. Un video no se edita aquí: su miniatura y su vista
    salen de un fotograma (el póster, con ffmpeg), su duración y medidas de ffprobe,
    y se reproduce en el visor. Las piezas de video que exporta Prensa entran solas
    (servicios/estudio_mediateca.py de Qillqa, el puente de los editores).

El mismo cálculo geométrico corre en el editor de la web
(frontend/src/componentes/fototeca/geometria.ts): lo que se ve al editar es lo
que sale al exportar. Las funciones puras (EXIF, geometría, normalización) van
arriba y tienen prueba (tests/test_fototeca.py); Pillow se importa dentro de
las funciones que lo usan para que la API arranque aunque falte.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import subprocess
import unicodedata
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from rikchay.config import config
from rikchay.config import raiz as raiz_fototeca
from rikchay.modelos import AMBITOS, COLORES, SELECCIONES, TILDES

# --- Constantes -------------------------------------------------------------------------

ESTADOS = ("por_revisar", "publica", "reservada")
TIPOS_VINCULO = ("semana", "proyecto", "documento")
EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff", ".avif"}
EXTENSIONES_VIDEO = {".mp4", ".m4v", ".mov", ".webm"}
MEDIOS = ("foto", "video")
MAX_FOTO = 60 * 1024 * 1024
MAX_VIDEO = 2048 * 1024 * 1024
MEDIA_VIDEO = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}
# Lado mayor de cada derivado (px).
TAMANOS = {"miniatura": 400, "vista": 1600, "crudo": 1600}
CALIDAD = {"miniatura": 78, "vista": 86, "crudo": 86}
# Formato del archivo según lo que diga Pillow.
EXT_FORMATO = {"JPEG": ".jpg", "MPO": ".jpg", "PNG": ".png", "WEBP": ".webp", "TIFF": ".tif", "HEIF": ".heic", "AVIF": ".avif"}

# Tamaños de exportación: proporción (ancho/alto) y medidas de salida. `None` en la
# proporción = la del encuadre; en las medidas = sin reducir (o lado mayor si es int).
PRESETS: dict[str, dict] = {
    "original": {"etiqueta": "Original con ajustes", "proporcion": None, "medidas": None},
    "documento": {"etiqueta": "Documento (lado mayor 2400 px)", "proporcion": None, "medidas": 2400},
    "informe": {"etiqueta": "Informe 3:2", "proporcion": 3 / 2, "medidas": (2400, 1600)},
    "publicacion": {"etiqueta": "Publicación 4:5", "proporcion": 4 / 5, "medidas": (1080, 1350)},
    "cuadrada": {"etiqueta": "Cuadrada 1:1", "proporcion": 1.0, "medidas": (1080, 1080)},
    "historia": {"etiqueta": "Historia 9:16", "proporcion": 9 / 16, "medidas": (1080, 1920)},
}
FORMATOS = {"jpg": ("JPEG", "image/jpeg"), "webp": ("WEBP", "image/webp")}


class ErrorFototeca(RuntimeError):
    pass


def es_video(nombre: str | Path | None) -> bool:
    """¿Es un video por su extensión? (el nombre subido o el `archivo` guardado)."""
    return Path(str(nombre or "")).suffix.lower() in EXTENSIONES_VIDEO


def admitido(nombre: str | Path | None) -> bool:
    suf = Path(str(nombre or "")).suffix.lower()
    return suf in EXTENSIONES or suf in EXTENSIONES_VIDEO


def zona() -> ZoneInfo:
    try:
        return ZoneInfo(config.zona_horaria)
    except Exception:  # noqa: BLE001 — zona mal escrita en .env: UTC antes que caer
        return ZoneInfo("UTC")


# --- Normalización (puras) ----------------------------------------------------------------


def _numero(v, defecto: float, minimo: float, maximo: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return defecto
    if math.isnan(x):
        return defecto
    return max(minimo, min(maximo, x))


def normalizar_ajustes(d: dict | None) -> dict:
    """Deja solo ajustes válidos y distintos del neutro: {} es «sin editar».

    rotar: 0/90/180/270 (horario) · voltear / voltear_v: espejo horizontal / vertical ·
    enderezar: grados (−45…45, horario) · recorte: [x, y, ancho, alto] relativos (0–1)
    al encuadre ya girado y enderezado · brillo / contraste / saturacion: factor (0–2, 1 = igual).
    """
    d = d or {}
    r: dict = {}
    try:
        rotar = int(d.get("rotar") or 0) % 360
    except (TypeError, ValueError):
        rotar = 0
    if rotar in (90, 180, 270):
        r["rotar"] = rotar
    if d.get("voltear"):
        r["voltear"] = True
    if d.get("voltear_v"):
        r["voltear_v"] = True
    enderezar = round(_numero(d.get("enderezar"), 0.0, -45.0, 45.0), 2)
    if enderezar:
        r["enderezar"] = enderezar
    rec = d.get("recorte")
    if isinstance(rec, (list, tuple)) and len(rec) == 4:
        x, y, w, h = (_numero(v, -1.0, -1.0, 2.0) for v in rec)
        x, y = max(0.0, min(1.0, x)), max(0.0, min(1.0, y))
        w, h = min(w, 1.0 - x), min(h, 1.0 - y)
        if w >= 0.01 and h >= 0.01 and (x, y, w, h) != (0.0, 0.0, 1.0, 1.0):
            r["recorte"] = [round(x, 5), round(y, 5), round(w, 5), round(h, 5)]
    for clave in ("brillo", "contraste", "saturacion"):
        v = round(_numero(d.get(clave), 1.0, 0.0, 2.0), 3)
        if v != 1.0:
            r[clave] = v
    return r


def clave_ajustes(ajustes: dict | None) -> str:
    """Huella corta de los ajustes: nombre de los derivados y `version` para la web."""
    a = normalizar_ajustes(ajustes)
    if not a:
        return "0"
    return hashlib.sha1(json.dumps(a, sort_keys=True).encode()).hexdigest()[:12]


def normalizar_lista(valores, maximo: int = 60) -> list[str]:
    """Etiquetas o personas: sin espacios de más, sin vacíos ni repetidas (sin
    distinguir mayúsculas), en el orden en que llegaron."""
    vistos: set[str] = set()
    salida: list[str] = []
    for v in valores or []:
        t = re.sub(r"\s+", " ", str(v or "")).strip()[:maximo]
        if t and t.casefold() not in vistos:
            vistos.add(t.casefold())
            salida.append(t)
    return salida


def parsear_vinculo(texto: str | None) -> tuple[str, int | None] | None:
    """«semana:3» → ('semana', 3); «semana» → ('semana', None); otra cosa → None."""
    if not texto:
        return None
    tipo, _, ident = str(texto).partition(":")
    if tipo not in TIPOS_VINCULO:
        return None
    if not ident:
        return tipo, None
    try:
        return tipo, int(ident)
    except ValueError:
        return None


def slug(texto: str, maximo: int = 60) -> str:
    base = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9]+", "-", base).strip("-").lower()
    return base[:maximo].strip("-") or "foto"


# --- EXIF (puras) ---------------------------------------------------------------------------


def fecha_exif(texto, desfase: str | None = None) -> datetime | None:
    """«2026:09:14 10:32:05» (DateTimeOriginal) → datetime con zona. Con `desfase`
    (OffsetTimeOriginal, «-05:00») se usa ese; sin él, la zona de la entidad."""
    if not texto:
        return None
    t = str(texto).strip().replace("\x00", "")
    m = re.match(r"^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})", t)
    if not m:
        return None
    try:
        dt = datetime(*(int(g) for g in m.groups()))
    except ValueError:
        return None
    if dt.year < 1990:  # cámaras sin hora puesta: 0000:00:00 o 1970
        return None
    if desfase:
        d = re.match(r"^([+-])(\d{2}):?(\d{2})$", str(desfase).strip())
        if d:
            from datetime import timedelta, timezone

            minutos = int(d.group(2)) * 60 + int(d.group(3))
            return dt.replace(tzinfo=timezone(timedelta(minutes=minutos if d.group(1) == "+" else -minutos)))
    return dt.replace(tzinfo=zona())


# Fecha (y hora, si está) escrita en el nombre: «IMG_20261014_103205», «WhatsApp Image 2026-10-14 at
# 10.32.05», «IMG-20261014-WA0001», «Screenshot_2026-10-14-10-32-05». WhatsApp borra el EXIF, así
# que sin esto una foto reenviada caería en el día en que se subió.
_NOMBRE_CON_HORA = re.compile(r"(?<!\d)(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:[ _\-T]|\s*at\s*)?"
                              r"(\d{2})[.:\-_h]?(\d{2})[.:\-_m]?(\d{2})", re.IGNORECASE)
_NOMBRE_SOLO_DIA = re.compile(r"(?<!\d)(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)")


def fecha_del_nombre(nombre: str) -> datetime | None:
    """La fecha de la toma escrita en el nombre del archivo, en la zona de la entidad; None si no
    trae una fecha creíble (entre 1990 y el año siguiente)."""
    base = Path(nombre or "").stem
    for patron in (_NOMBRE_CON_HORA, _NOMBRE_SOLO_DIA):
        for m in patron.finditer(base):
            try:
                dt = datetime(*(int(g) for g in m.groups()))
            except ValueError:
                continue
            if 1990 <= dt.year <= datetime.now().year + 1:
                return dt.replace(tzinfo=zona())
    return None


def _racional(v) -> float:
    if isinstance(v, (tuple, list)) and len(v) == 2:
        return float(v[0]) / float(v[1]) if float(v[1]) else 0.0
    return float(v)


def gps_decimal(dms, ref) -> float | None:
    """((12, 3, 30.5), 'S') → −12.05847. Acepta racionales de Pillow, tuplas (n, d) o números."""
    try:
        g, m, s = (_racional(x) for x in dms)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    valor = g + m / 60 + s / 3600
    if str(ref or "").upper().strip("\x00 ") in ("S", "W"):
        valor = -valor
    return round(valor, 7)


# --- Geometría (puras; la misma de geometria.ts) -----------------------------------------


def medidas_rotadas(ancho: float, alto: float, rotar: int) -> tuple[float, float]:
    return (alto, ancho) if rotar in (90, 270) else (ancho, alto)


def escala_enderezar(ancho: float, alto: float, grados: float) -> float:
    """Al enderezar, el mayor rectángulo de la MISMA proporción que cabe dentro de la
    foto girada, como fracción del tamaño original (1 = sin pérdida)."""
    if not grados or ancho <= 0 or alto <= 0:
        return 1.0
    a = math.radians(abs(grados))
    c, s = math.cos(a), math.sin(a)
    return min(ancho / (ancho * c + alto * s), alto / (ancho * s + alto * c))


def encuadre(ancho: float, alto: float, ajustes: dict | None) -> tuple[float, float]:
    """Medidas de la foto tras los ajustes geométricos (girar, enderezar, recortar)."""
    a = normalizar_ajustes(ajustes)
    w, h = medidas_rotadas(ancho, alto, a.get("rotar", 0))
    e = escala_enderezar(w, h, a.get("enderezar", 0))
    w, h = w * e, h * e
    if "recorte" in a:
        _, _, rw, rh = a["recorte"]
        w, h = w * rw, h * rh
    return w, h


def proporcion(ancho: float, alto: float, ajustes: dict | None) -> float:
    w, h = encuadre(ancho, alto, ajustes)
    return round(w / h, 4) if h else 1.0


def caja_recorte(ancho: int, alto: int, recorte: list[float]) -> tuple[int, int, int, int]:
    """Recorte relativo → caja de Pillow (izq, arriba, der, abajo) dentro de la imagen."""
    x, y, w, h = recorte
    izq = max(0, min(ancho - 1, round(x * ancho)))
    arr = max(0, min(alto - 1, round(y * alto)))
    der = max(izq + 1, min(ancho, round((x + w) * ancho)))
    aba = max(arr + 1, min(alto, round((y + h) * alto)))
    return izq, arr, der, aba


def caja_proporcion(ancho: int, alto: int, prop: float) -> tuple[int, int, int, int]:
    """La mayor caja centrada de proporción `prop` (ancho/alto) que cabe en la imagen."""
    if ancho / alto > prop:
        w = max(1, round(alto * prop))
        x = (ancho - w) // 2
        return x, 0, x + w, alto
    h = max(1, round(ancho / prop))
    y = (alto - h) // 2
    return 0, y, ancho, y + h


# --- Filtros de la lista (puros) -----------------------------------------------------------


@dataclass
class Filtros:
    q: str = ""
    album: int | None = None  # 0 = sin álbum
    etiqueta: str = ""
    persona: str = ""
    estado: str = ""
    favorita: bool = False
    desde: date | None = None
    hasta: date | None = None
    mes: str = ""  # AAAA-MM (línea de tiempo)
    vinculo: tuple[str, int | None] | None = None
    papelera: bool = False
    ids: list[int] = field(default_factory=list)
    medio: str = ""  # foto | video | "" (los dos)
    ambito: str = "actividad"  # actividad | marca | todo
    categoria: str = ""  # en la marca: logo, retrato, marco, recurso, color
    versiones: bool = False  # True: también las versiones editadas (ocultas en la lista)
    # Depuración como en digiKam: aceptada | pendiente | rechazada | ninguna (sin marca); color o «ninguno».
    seleccion: str = ""
    color: str = ""
    # Búsqueda facetada (2026-10-19): año de la toma, lugar, calificación mínima, cámara y si se usa en algo.
    anio: int | None = None
    lugar: str = ""
    calificacion: int = 0  # 1–5 = al menos esas estrellas
    camara: str = ""
    uso: str = ""  # con | sin | "" (las dos)


def leer_filtros(q: str = "", album: str = "", etiqueta: str = "", persona: str = "", estado: str = "",
                 favorita: bool = False, desde: str = "", hasta: str = "", mes: str = "",
                 vinculo: str = "", papelera: bool = False, medio: str = "", ambito: str = "actividad",
                 categoria: str = "", seleccion: str = "", color: str = "", anio: str = "", lugar: str = "",
                 calificacion: str = "", camara: str = "", uso: str = "", ids: str = "") -> Filtros:
    """Los parámetros de la consulta, validados (lo inválido se ignora, no da 422)."""
    def _fecha(t: str) -> date | None:
        try:
            return date.fromisoformat(t) if t else None
        except ValueError:
            return None

    alb: int | None = None
    if album == "ninguno":
        alb = 0
    elif album.isdigit():
        alb = int(album)
    return Filtros(
        q=q.strip()[:200],
        album=alb,
        etiqueta=etiqueta.strip(),
        persona=persona.strip(),
        estado=estado if estado in ESTADOS else "",
        favorita=bool(favorita),
        desde=_fecha(desde),
        hasta=_fecha(hasta),
        mes=mes if re.match(r"^\d{4}-\d{2}$", mes or "") else "",
        vinculo=parsear_vinculo(vinculo),
        papelera=bool(papelera),
        medio=medio if medio in MEDIOS else "",
        ambito=ambito if ambito in AMBITOS or ambito == "todo" else "actividad",
        categoria=categoria if re.match(r"^[a-z]{1,20}$", categoria or "") else "",
        seleccion=seleccion if seleccion in SELECCIONES[1:] or seleccion == "ninguna" else "",
        color=color if color in COLORES[1:] or color == "ninguno" else "",
        anio=int(anio) if re.fullmatch(r"(19|20)\d\d", anio or "") else None,
        lugar=lugar.strip()[:200],
        calificacion=int(calificacion) if re.fullmatch(r"[1-5]", calificacion or "") else 0,
        camara=camara.strip()[:160],
        uso=uso if uso in ("con", "sin") else "",
        # Unas fotos concretas («3,8,15»; las de un punto del mapa), como mucho 500.
        ids=[int(x) for x in (ids or "").split(",") if x.strip().isdigit()][:500],
    )


def palabras_busqueda(q: str) -> list[str]:
    """Las palabras de una búsqueda normalizadas como el índice de texto (`EXPR_BUSQUEDA`): minúsculas, sin
    tildes y partidas en todo signo («SR-05» → «sr», «05»). Solo letras y cifras: van seguras a `to_tsquery`."""
    limpio = unicodedata.normalize("NFC", (q or "").lower()).translate(str.maketrans(*TILDES))
    return re.findall(r"[a-z0-9]+", limpio)[:12]


def consulta_texto(q: str) -> str:
    """La consulta de `to_tsquery`: cada palabra por prefijo y todas a la vez («visita:* & huanuco:*»)."""
    return " & ".join(f"{p}:*" for p in palabras_busqueda(q))


def condiciones(f: Filtros) -> list:
    """Condiciones SQLAlchemy de los filtros sobre `Foto`."""
    from sqlalchemy import and_, func, or_

    from rikchay.modelos import Foto

    tz = config.zona_horaria
    dia = func.date(func.timezone(tz, Foto.tomada_en))
    c: list = [Foto.eliminada_en.isnot(None) if f.papelera else Foto.eliminada_en.is_(None)]
    if f.q:
        # El índice de texto de PostgreSQL (columna generada `busqueda`, índice GIN), cada palabra por prefijo.
        consulta = consulta_texto(f.q)
        if consulta:
            c.append(Foto.busqueda.op("@@")(func.to_tsquery("simple", consulta)))
    if f.album is not None:
        c.append(Foto.album_id.is_(None) if f.album == 0 else Foto.album_id == f.album)
    if f.etiqueta:
        c.append(Foto.etiquetas.contains([f.etiqueta]))
    if f.persona:
        c.append(Foto.personas.contains([f.persona]))
    if f.estado:
        c.append(Foto.estado == f.estado)
    if f.favorita:
        c.append(Foto.favorita.is_(True))
    if f.desde:
        c.append(dia >= f.desde)
    if f.hasta:
        c.append(dia <= f.hasta)
    if f.mes:
        c.append(func.to_char(func.timezone(tz, Foto.tomada_en), "YYYY-MM") == f.mes)
    if f.vinculo:
        tipo, ident = f.vinculo
        c.append(Foto.vinculos.contains([{"tipo": tipo, "id": ident} if ident is not None else {"tipo": tipo}]))
    if f.ids:
        c.append(Foto.id.in_(f.ids))
    if f.medio:
        c.append(Foto.medio == f.medio)
    if f.ambito != "todo":
        c.append(Foto.ambito == f.ambito)
    if f.categoria:
        c.append(Foto.categoria == f.categoria)
    if f.seleccion:
        c.append(Foto.seleccion == ("" if f.seleccion == "ninguna" else f.seleccion))
    if f.color:
        c.append(Foto.color == ("" if f.color == "ninguno" else f.color))
    if f.anio:
        c.append(func.extract("year", func.timezone(tz, Foto.tomada_en)) == f.anio)
    if f.lugar:
        c.append(Foto.lugar == f.lugar)
    if f.calificacion:
        c.append(Foto.calificacion >= f.calificacion)
    if f.camara:
        c.append(Foto.camara == f.camara)
    if f.uso:
        from sqlalchemy import exists, select

        from rikchay.modelos import Uso
        usada = or_(func.jsonb_array_length(Foto.vinculos) > 0, exists(select(Uso.id).where(Uso.foto_id == Foto.id)))
        c.append(usada if f.uso == "con" else ~usada)
    if not f.versiones and not f.ids:
        # Una versión editada (la que cita una semana) se ve desde su original, no suelta en la lista. Una pieza
        # de Prensa hecha con una foto (versión «exportacion», 2026-10-20) sí sale en su panel: es un producto.
        from sqlalchemy import select

        from rikchay.modelos import Version
        c.append(Foto.id.not_in(select(Version.derivada_id).where(Version.tipo != "exportacion")))
    return [and_(*c)] if c else []


# La búsqueda facetada (2026-10-19): cada faceta, el campo de `Filtros` que se suelta para contarla y su valor
# suelto. Al contar una faceta se suelta SOLO su filtro: cada opción dice cuántas fotos quedarían al elegirla junto
# con todo lo demás (así se combinan año + persona + lugar sin quedar en cero a ciegas).
FACETAS = (
    ("anio", "anio", None), ("ambito", "ambito", "todo"), ("seleccion", "seleccion", ""), ("color", "color", ""),
    ("calificacion", "calificacion", 0), ("etiqueta", "etiqueta", ""), ("persona", "persona", ""),
    ("lugar", "lugar", ""), ("camara", "camara", ""), ("medio", "medio", ""), ("uso", "uso", ""),
)
MAX_OPCIONES = 60


def filtros_de_faceta(f: Filtros, campo: str, suelto) -> Filtros:
    from dataclasses import replace

    extra = {"categoria": ""} if campo == "ambito" else {}
    return replace(f, **{campo: suelto}, **extra)


def consultas_facetas(f: Filtros) -> dict:
    """Una consulta (valor, cuántas) por faceta, con los demás filtros de `f` puestos."""
    from sqlalchemy import Integer, case, exists, func, literal_column, or_, select

    from rikchay.modelos import Foto
    from rikchay.modelos import Uso

    tz = config.zona_horaria
    usada = or_(func.jsonb_array_length(Foto.vinculos) > 0, exists(select(Uso.id).where(Uso.foto_id == Foto.id)))
    columnas = {
        "anio": func.extract("year", func.timezone(tz, Foto.tomada_en)).cast(Integer),
        "ambito": Foto.ambito,
        "seleccion": Foto.seleccion,
        "color": Foto.color,
        "calificacion": Foto.calificacion,
        "lugar": Foto.lugar,
        "camara": Foto.camara,
        "medio": Foto.medio,
        "uso": case((usada, literal_column("'con'")), else_=literal_column("'sin'")),
    }
    salida = {}
    for nombre, campo, suelto in FACETAS:
        cond = condiciones(filtros_de_faceta(f, campo, suelto))
        if nombre in ("etiqueta", "persona"):
            lista = Foto.etiquetas if nombre == "etiqueta" else Foto.personas
            sub = select(func.jsonb_array_elements_text(lista).label("v")).where(*cond).subquery()
            consulta = select(sub.c.v, func.count()).group_by(sub.c.v)
        else:
            col = columnas[nombre]
            consulta = select(col.label("v"), func.count()).where(*cond).group_by(col)
            if nombre in ("color", "lugar", "camara"):
                consulta = consulta.where(col != "")
        if nombre in ("etiqueta", "persona", "lugar", "camara"):
            consulta = consulta.order_by(func.count().desc(), literal_column("v")).limit(MAX_OPCIONES)
        else:
            consulta = consulta.order_by(literal_column("v").desc() if nombre in ("anio", "calificacion") else literal_column("v"))
        salida[nombre] = consulta
    return salida


ORDENES = ("reciente", "antigua", "subida", "calificacion", "nombre")


def orden(clave: str) -> list:
    from rikchay.modelos import Foto

    return {
        "antigua": [Foto.tomada_en.asc(), Foto.id.asc()],
        "subida": [Foto.creado_en.desc(), Foto.id.desc()],
        "calificacion": [Foto.calificacion.desc(), Foto.tomada_en.desc(), Foto.id.desc()],
        "nombre": [Foto.nombre_original.asc(), Foto.id.asc()],
    }.get(clave, [Foto.tomada_en.desc(), Foto.id.desc()])


# --- Archivos ---------------------------------------------------------------------------


def raiz() -> Path:
    return raiz_fototeca()


def ruta_original(archivo: str) -> Path:
    """Ruta en el disco de un original, sin salir de la Mediateca ni entrar a su caché."""
    base = raiz().resolve()
    ruta = (base / archivo).resolve()
    if base not in ruta.parents or (base / "cache") in ruta.parents or ruta.name.startswith("."):
        raise ErrorFototeca("Ruta de original fuera de la Mediateca.")
    return ruta


def nombre_por_fecha(momento: datetime, extension: str, ocupado) -> str:
    """«2026/20261018_182530.jpg» (hora local de la toma); si `ocupado(rel)`, «…_2», «…_3»."""
    local = momento.astimezone(zona()) if momento.tzinfo else momento
    base = f"{local:%Y}/{local:%Y%m%d_%H%M%S}"
    ext = ".jpg" if extension.lower() in (".jpeg", ".jpg") else extension.lower()
    rel, n = f"{base}{ext}", 1
    while ocupado(rel):
        n += 1
        rel = f"{base}_{n}{ext}"
    return rel


def slug_marca(texto: str) -> str:
    """Nombre de archivo de un activo de marca: minúsculas, sin tildes ni espacios, con guiones
    («CR - IMAGOTIPO-FONDO1» → «cr-imagotipo-fondo-1»)."""
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"(?<=[a-z])(?=\d)", "-", t)
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return re.sub(r"-{2,}", "-", t) or "sin-nombre"


def _imagen():
    try:
        from PIL import Image, ImageOps  # noqa: F401
    except ImportError as e:  # pragma: no cover — depende del entorno
        raise ErrorFototeca("Falta Pillow en el servidor (pip install -e .).") from e
    try:  # HEIC del celular, si el complemento está instalado (opcional)
        from pillow_heif import register_heif_opener  # type: ignore

        register_heif_opener()
    except ImportError:
        pass
    from PIL import Image

    return Image


def abrir(ruta: Path, lado: int | None = None):
    """La foto girada según su EXIF, en RGB. Con `lado`, el decodificador JPEG puede
    leerla ya reducida (draft) siempre que quede ≥ `lado`: la vista no lee 24 MP.
    Lo que Pillow no abre (HEIC sin complemento) pasa por ImageMagick."""
    Image = _imagen()
    from PIL import ImageOps, UnidentifiedImageError

    try:
        img = Image.open(ruta)
    except (UnidentifiedImageError, OSError):
        img = _por_magick(ruta)
    if lado and img.format == "JPEG":
        img.draft("RGB", (lado, lado))
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        fondo = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            fondo.paste(img, mask=img.split()[-1])
            img = fondo
        else:
            img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")
    return img


def _por_magick(ruta: Path):
    Image = _imagen()
    tmp = raiz() / "cache" / "conversiones" / f"{hashlib.sha1(str(ruta).encode()).hexdigest()[:16]}.png"
    if not tmp.is_file() or tmp.stat().st_mtime < ruta.stat().st_mtime:
        tmp.parent.mkdir(parents=True, exist_ok=True)
        try:
            r = subprocess.run(["magick", str(ruta) + "[0]", "-auto-orient", str(tmp)],
                               capture_output=True, timeout=120)
        except (OSError, subprocess.SubprocessError) as e:
            raise ErrorFototeca("No es una imagen que el servidor sepa leer.") from e
        if r.returncode != 0 or not tmp.is_file():
            raise ErrorFototeca("No es una imagen que el servidor sepa leer.")
    return Image.open(tmp)


def aplicar_ajustes(img, ajustes: dict | None):
    """Los ajustes, en el orden del editor: girar, voltear, enderezar, recortar, color."""
    from PIL import Image, ImageEnhance

    a = normalizar_ajustes(ajustes)
    giro = {90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}
    if a.get("rotar"):
        img = img.transpose(giro[a["rotar"]])
    if a.get("voltear"):
        img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if a.get("voltear_v"):
        img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    if a.get("enderezar"):
        w, h = img.size
        e = escala_enderezar(w, h, a["enderezar"])
        # Pillow gira en sentido antihorario; el ajuste es horario (como el CSS del editor).
        girada = img.rotate(-a["enderezar"], resample=Image.Resampling.BICUBIC, expand=True)
        gw, gh = girada.size
        nw, nh = max(1, int(w * e)), max(1, int(h * e))
        x, y = (gw - nw) // 2, (gh - nh) // 2
        img = girada.crop((x, y, x + nw, y + nh))
    if a.get("recorte"):
        img = img.crop(caja_recorte(img.width, img.height, a["recorte"]))
    if "brillo" in a:
        img = ImageEnhance.Brightness(img).enhance(a["brillo"])
    if "contraste" in a:
        img = ImageEnhance.Contrast(img).enhance(a["contraste"])
    if "saturacion" in a:
        img = ImageEnhance.Color(img).enhance(a["saturacion"])
    return img


def _reducir(img, lado: int):
    from PIL import Image

    if max(img.size) > lado:
        img = img.copy()
        img.thumbnail((lado, lado), Image.Resampling.LANCZOS)
    return img


def _lado_lectura(lado: int, ajustes: dict) -> int:
    """Cuánto hay que leer del original para que, tras recortar, queden `lado` px."""
    rec = ajustes.get("recorte")
    frac = min(rec[2], rec[3]) if rec else 1.0
    return int(lado / max(frac, 0.05) * 1.15)


def derivado(archivo: str, sha: str, ajustes: dict | None, tipo: str) -> Path:
    """Miniatura, vista o «crudo» (la vista sin ajustes, base del editor), en caché.
    El nombre lleva la huella de los ajustes: un ajuste nuevo es otro archivo."""
    video = es_video(archivo)
    a = {} if tipo == "crudo" or video else normalizar_ajustes(ajustes)
    destino = raiz() / "cache" / tipo / sha[:2] / f"{sha}-{clave_ajustes(a)}.jpg"
    if destino.is_file():
        return destino
    lado = TAMANOS[tipo]
    fuente = poster(archivo, sha) if video else ruta_original(archivo)
    img = abrir(fuente, _lado_lectura(lado, a))
    img = _reducir(aplicar_ajustes(img, a), lado)
    _guardar(img, destino, "JPEG", CALIDAD[tipo])
    return destino


def _guardar(img, destino: Path, formato: str, calidad: int) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(f".{destino.name}.{uuid.uuid4().hex[:8]}")
    opciones = {"quality": calidad}
    if formato == "JPEG":
        opciones.update(optimize=True, progressive=True)
    img.save(tmp, formato, **opciones)
    tmp.replace(destino)


def exportar(archivo: str, sha: str, ajustes: dict | None, preset: str, formato: str = "jpg") -> Path:
    """La foto con sus ajustes en un tamaño de salida (PRESETS), en caché."""
    if es_video(archivo):
        raise ErrorFototeca("Un video se descarga como original: no tiene tamaños de exportación.")
    if preset not in PRESETS:
        raise ErrorFototeca(f"Tamaño de exportación desconocido: {preset}.")
    if formato not in FORMATOS:
        raise ErrorFototeca(f"Formato desconocido: {formato}.")
    a = normalizar_ajustes(ajustes)
    p = PRESETS[preset]
    destino = raiz() / "cache" / "exportes" / sha[:2] / f"{sha}-{clave_ajustes(a)}-{preset}.{formato}"
    if destino.is_file():
        return destino
    img = aplicar_ajustes(abrir(ruta_original(archivo)), a)
    if p["proporcion"]:
        img = img.crop(caja_proporcion(img.width, img.height, p["proporcion"]))
    medidas = p["medidas"]
    if isinstance(medidas, int):
        img = _reducir(img, medidas)
    elif medidas:
        from PIL import Image

        # Sin agrandar: una foto chica conserva su tamaño (ya tiene la proporción).
        if img.width > medidas[0]:
            img = img.resize(medidas, Image.Resampling.LANCZOS)
    pil, _ = FORMATOS[formato]
    _guardar(img, destino, pil, 92)
    return destino


def nombre_exportado(nombre_original: str, titulo: str, preset: str, formato: str) -> str:
    base = slug(titulo) if titulo else slug(Path(nombre_original or "foto").stem)
    return f"{base}_{preset}.{formato}"


def armar_zip(entradas: list[tuple[Path, str]]) -> Path:
    """Un .zip con las exportaciones (descarga en lote). Los lotes de más de un día se borran."""
    carpeta = raiz() / "cache" / "lotes"
    carpeta.mkdir(parents=True, exist_ok=True)
    ahora = datetime.now().timestamp()
    for viejo in carpeta.glob("*.zip"):
        if ahora - viejo.stat().st_mtime > 86400:
            viejo.unlink(missing_ok=True)
    destino = carpeta / f"fototeca-{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}.zip"
    usados: set[str] = set()
    with zipfile.ZipFile(destino, "w", zipfile.ZIP_STORED) as z:
        for ruta, nombre in entradas:
            final, n = nombre, 1
            while final in usados:
                final = f"{Path(nombre).stem}-{n}{Path(nombre).suffix}"
                n += 1
            usados.add(final)
            z.write(ruta, final)
    return destino


def sugerir_ajustes(archivo: str, sha: str) -> dict:
    """Mejora automática prudente: lleva la luminosidad media hacia el centro y
    estira el contraste si la foto está «lavada». Solo propone; se guarda al aceptar."""
    from PIL import ImageStat

    if es_video(archivo):
        raise ErrorFototeca("Los videos no se editan en la Fototeca.")
    vista = abrir(derivado(archivo, sha, {}, "crudo"))
    gris = vista.convert("L")
    st = ImageStat.Stat(gris)
    media, desvio = st.mean[0], st.stddev[0]
    brillo = 1.0
    if media < 105:
        brillo = min(1.35, 118 / max(media, 30))
    elif media > 165:
        brillo = max(0.8, 150 / media)
    contraste = 1.0
    if desvio < 45:
        contraste = min(1.3, 55 / max(desvio, 20))
    return normalizar_ajustes({"brillo": round(brillo, 2), "contraste": round(contraste, 2), "saturacion": 1.08})


# --- Alta de originales -------------------------------------------------------------------


@dataclass
class Leido:
    """Lo que se lee de un archivo al darlo de alta."""

    sha256: str
    bytes: int
    ancho: int
    alto: int
    extension: str
    tomada_en: datetime | None
    camara: str
    lat: float | None
    lon: float | None
    exif: dict
    medio: str = "foto"
    duracion: float | None = None


def huella(ruta: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    tam = 0
    with ruta.open("rb") as fh:
        while trozo := fh.read(1024 * 1024):
            h.update(trozo)
            tam += len(trozo)
    return h.hexdigest(), tam


def leer_archivo(ruta: Path) -> Leido:
    """Huella, medidas (ya giradas) y EXIF de una foto. Falla si no es una imagen."""
    Image = _imagen()
    from PIL import ImageOps, UnidentifiedImageError

    sha, tam = huella(ruta)
    try:
        img = Image.open(ruta)
        formato = img.format or ""
    except (UnidentifiedImageError, OSError):
        img = _por_magick(ruta)
        formato = "HEIF" if ruta.suffix.lower() in (".heic", ".heif") else "PNG"
    ext = EXT_FORMATO.get(formato)
    if ext is None:
        raise ErrorFototeca(f"Formato no admitido ({formato or 'desconocido'}).")
    exif = img.getexif()
    datos = _leer_exif(exif)
    girada = ImageOps.exif_transpose(img) if formato != "HEIF" else img
    ancho, alto = girada.size
    return Leido(sha, tam, ancho, alto, ext, datos.pop("_fecha"), datos.pop("_camara"),
                 datos.pop("_lat"), datos.pop("_lon"), datos)


def _leer_exif(exif) -> dict:
    """Fecha, cámara, GPS y lo útil para la ficha (exposición, ISO, focal) del EXIF."""
    from PIL.ExifTags import IFD

    base = dict(exif or {})
    try:
        sub = dict(exif.get_ifd(IFD.Exif)) if exif else {}
    except Exception:  # noqa: BLE001 — EXIF roto: se sigue sin él
        sub = {}
    try:
        gps = dict(exif.get_ifd(IFD.GPSInfo)) if exif else {}
    except Exception:  # noqa: BLE001
        gps = {}
    fecha = fecha_exif(sub.get(36867) or sub.get(36868) or base.get(306), sub.get(36881))
    marca = str(base.get(271) or "").strip("\x00 ")
    modelo = str(base.get(272) or "").strip("\x00 ")
    camara = modelo if marca and modelo.lower().startswith(marca.lower().split()[0]) else f"{marca} {modelo}".strip()
    lat = gps_decimal(gps[2], gps.get(1)) if 2 in gps else None
    lon = gps_decimal(gps[4], gps.get(3)) if 4 in gps else None
    if lat is not None and lon is not None and lat == 0 and lon == 0:
        lat = lon = None

    def _txt(v) -> str | None:
        try:
            return str(round(_racional(v), 4)).rstrip("0").rstrip(".")
        except (TypeError, ValueError, ZeroDivisionError):
            return None

    ficha: dict = {}
    exposicion = sub.get(33434)
    if exposicion:
        try:
            x = _racional(exposicion)
            ficha["exposicion"] = f"1/{round(1 / x)} s" if 0 < x < 1 else f"{_txt(x)} s"
        except (TypeError, ValueError, ZeroDivisionError):
            pass
    if sub.get(33437):
        ficha["apertura"] = f"f/{_txt(sub[33437])}"
    if sub.get(34855):
        ficha["iso"] = str(sub[34855] if not isinstance(sub[34855], tuple) else sub[34855][0])
    if sub.get(37386):
        ficha["focal"] = f"{_txt(sub[37386])} mm"
    if sub.get(42036):
        ficha["objetivo"] = str(sub[42036]).strip("\x00 ")[:120]
    if base.get(305):
        ficha["programa"] = str(base[305]).strip("\x00 ")[:120]
    return {"_fecha": fecha, "_camara": camara[:160], "_lat": lat, "_lon": lon, **ficha}


# --- Videos (2026-10-06) -------------------------------------------------------------------


def iso6709(texto) -> tuple[float, float] | None:
    """«+12.0464-077.0428+150.000/» (la ubicación de los videos del celular) → (lat, lon)."""
    m = re.match(r"^\s*([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)", str(texto or ""))
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    return round(lat, 7), round(lon, 7)


def fecha_video(texto) -> datetime | None:
    """La fecha de grabación de las etiquetas del contenedor: «2026-09-14T15:32:05.000000Z»
    (UTC, `creation_time`) o «2026-09-14T10:32:05-0500» (la del celular, con su zona)."""
    t = str(texto or "").strip()
    if not t:
        return None
    t = re.sub(r"\.\d+", "", t).replace("Z", "+00:00")
    t = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", t)
    try:
        dt = datetime.fromisoformat(t)
    except ValueError:
        return None
    if dt.year < 1990:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=zona())


def datos_ffprobe(info: dict) -> dict:
    """Lo útil de la salida JSON de ffprobe (`-show_format -show_streams`): medidas como se
    ve el video (ya giradas), duración, fecha, cámara, ubicación y una ficha técnica.
    Falla si no hay pista de video."""
    pistas = info.get("streams") or []
    video = next((p for p in pistas if p.get("codec_type") == "video"
                  and not (p.get("disposition") or {}).get("attached_pic")), None)
    if video is None:
        raise ErrorFototeca("El archivo no tiene imagen de video.")
    ancho, alto = int(video.get("width") or 0), int(video.get("height") or 0)
    giro = 0
    try:
        giro = int(float((video.get("tags") or {}).get("rotate") or 0))
    except (TypeError, ValueError):
        giro = 0
    for lado in video.get("side_data_list") or []:
        if "rotation" in lado:
            try:
                giro = int(float(lado["rotation"]))
            except (TypeError, ValueError):
                pass
    if abs(giro) % 180 == 90:
        ancho, alto = alto, ancho
    formato = info.get("format") or {}
    duracion = None
    for fuente in (formato.get("duration"), video.get("duration")):
        try:
            duracion = round(float(fuente), 3)
            break
        except (TypeError, ValueError):
            continue
    etiquetas = {str(k).lower(): v for k, v in (formato.get("tags") or {}).items()}
    fecha = fecha_video(etiquetas.get("com.apple.quicktime.creationdate")) or fecha_video(etiquetas.get("creation_time"))
    marca = str(etiquetas.get("com.apple.quicktime.make") or etiquetas.get("make") or "").strip()
    modelo = str(etiquetas.get("com.apple.quicktime.model") or etiquetas.get("model") or "").strip()
    camara = modelo if marca and modelo.lower().startswith(marca.lower().split()[0]) else f"{marca} {modelo}".strip()
    lugar = iso6709(etiquetas.get("com.apple.quicktime.location.iso6709") or etiquetas.get("location"))
    ficha: dict = {"codec": str(video.get("codec_name") or ""), "resolucion": f"{ancho}×{alto}"}
    cuadros = str(video.get("avg_frame_rate") or video.get("r_frame_rate") or "")
    if "/" in cuadros:
        n, d = cuadros.split("/", 1)
        try:
            if float(d):
                ficha["cuadros"] = f"{round(float(n) / float(d), 2):g} fps"
        except ValueError:
            pass
    audio = next((p for p in pistas if p.get("codec_type") == "audio"), None)
    ficha["audio"] = str(audio.get("codec_name") or "sí") if audio else "sin audio"
    return {"ancho": ancho, "alto": alto, "duracion": duracion, "fecha": fecha, "camara": camara[:160],
            "lat": lugar[0] if lugar else None, "lon": lugar[1] if lugar else None,
            "ficha": {k: v for k, v in ficha.items() if v}}


def leer_video(ruta: Path) -> Leido:
    """Huella, medidas, duración y etiquetas de un video (ffprobe). Falla si no es un video."""
    sha, tam = huella(ruta)
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
                            str(ruta)], capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        raise ErrorFototeca("Falta ffprobe (ffmpeg) en el servidor para leer videos.") from e
    try:
        info = json.loads(r.stdout or "{}")
    except ValueError:
        info = {}
    if r.returncode != 0 or not info:
        raise ErrorFototeca("No es un video que el servidor sepa leer.")
    d = datos_ffprobe(info)
    ext = ruta.suffix.lower() if ruta.suffix.lower() in EXTENSIONES_VIDEO else ".mp4"
    return Leido(sha, tam, d["ancho"], d["alto"], ext, d["fecha"], d["camara"], d["lat"], d["lon"], d["ficha"],
                 medio="video", duracion=d["duracion"])


def momento_poster(duracion: float | None) -> float:
    """De qué segundo sale el póster: un poco adentro (el primer cuadro suele ser negro)."""
    if not duracion or duracion <= 0:
        return 0.0
    return round(min(1.0, duracion * 0.1), 3)


def poster(archivo: str, sha: str) -> Path:
    """Un fotograma del video (JPEG, lado mayor 1600), base de su miniatura y su vista."""
    destino = raiz() / "cache" / "poster" / sha[:2] / f"{sha}.jpg"
    if destino.is_file():
        return destino
    origen = ruta_original(archivo)
    if not origen.is_file():
        raise FileNotFoundError(origen)
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(f".{destino.name}.{uuid.uuid4().hex[:8]}.jpg")
    duracion = None
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                            str(origen)], capture_output=True, text=True, timeout=60)
        duracion = float(r.stdout.strip() or 0)
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    for segundo in dict.fromkeys((momento_poster(duracion), 0.0)):
        try:
            r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(segundo), "-i", str(origen), "-frames:v", "1",
                                "-vf", "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease",
                                "-q:v", "3", str(tmp)], capture_output=True, timeout=120)
        except (OSError, subprocess.SubprocessError) as e:
            raise ErrorFototeca("Falta ffmpeg en el servidor para la miniatura del video.") from e
        if r.returncode == 0 and tmp.is_file() and tmp.stat().st_size:
            tmp.replace(destino)
            return destino
    tmp.unlink(missing_ok=True)
    raise ErrorFototeca("No se pudo sacar un fotograma del video.")


def guardar_original(origen: Path, leido: Leido, mover: bool, momento: datetime | None = None) -> str:
    """Copia (o mueve) el archivo a `AAAA/AAAAMMDD_HHMMSS.ext` (fecha de la toma o `momento`);
    devuelve la ruta relativa. Nunca pisa un archivo: si el nombre está, `_2`, `_3`…"""
    rel = nombre_por_fecha(momento or leido.tomada_en or datetime.now().astimezone(), leido.extension,
                           lambda r: (raiz() / r).exists())
    destino = raiz() / rel
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(f".{destino.name}.{uuid.uuid4().hex[:8]}")
    if mover:
        shutil.move(str(origen), tmp)
    else:
        shutil.copy2(origen, tmp)
    tmp.replace(destino)
    return rel


def carpeta_temporal() -> Path:
    t = raiz() / ".subidas"
    t.mkdir(parents=True, exist_ok=True)
    return t


def con_vinculo(vinculos: list | None, nuevo: dict) -> list:
    """Agrega el vínculo si no está (mismo tipo e id); si está, completa sus datos."""
    lista = [dict(v) for v in (vinculos or [])]
    for v in lista:
        if v.get("tipo") == nuevo.get("tipo") and v.get("id") == nuevo.get("id"):
            v.update({k: val for k, val in nuevo.items() if val not in (None, "")})
            return lista
    return lista + [{k: val for k, val in nuevo.items() if val not in (None, "")}]


async def registrar(sesion, ruta: Path, nombre: str, usuario_id: int | None, *, mover: bool = False,
                    vinculo: dict | None = None, datos: dict | None = None) -> tuple:
    """Da de alta una foto (o encuentra la que ya estaba por su huella).

    Devuelve (foto, nueva). Una ya registrada no se toca salvo para sumarle el
    `vinculo` y llenar los campos de `datos` que tuviera vacíos (importar dos veces
    no pisa lo que se corrigió en la Fototeca). No hace commit."""
    import asyncio

    from sqlalchemy import select

    from rikchay.modelos import Foto

    leido = await asyncio.to_thread(leer_video if es_video(ruta) else leer_archivo, ruta)
    existente = (await sesion.execute(select(Foto).where(Foto.sha256 == leido.sha256))).scalar_one_or_none()
    if existente is not None:
        if mover:
            ruta.unlink(missing_ok=True)
        if vinculo:
            existente.vinculos = con_vinculo(existente.vinculos, vinculo)
        for clave, valor in (datos or {}).items():
            if valor and not getattr(existente, clave, None):
                setattr(existente, clave, valor)
        return existente, False
    # La fecha la pone el archivo: su EXIF; si no trae, la de su nombre; si tampoco, la de subida.
    tomada, fuente = leido.tomada_en, "exif"
    if tomada is None:
        tomada = fecha_del_nombre(nombre)
        fuente = "nombre" if tomada else "subida"
    rel = await asyncio.to_thread(guardar_original, ruta, leido, mover, tomada)
    datos = dict(datos or {})
    foto = Foto(
        sha256=leido.sha256,
        nombre_original=Path(nombre).name[:300],
        archivo=rel,
        medio=leido.medio,
        duracion=leido.duracion,
        bytes=leido.bytes,
        ancho=leido.ancho,
        alto=leido.alto,
        tomada_en=tomada or datetime.now().astimezone(),
        fecha_exif=leido.tomada_en is not None,
        fecha_fuente=fuente,
        camara=leido.camara,
        lat=leido.lat,
        lon=leido.lon,
        exif=leido.exif,
        titulo=str(datos.pop("titulo", "") or "")[:300],
        descripcion=str(datos.pop("descripcion", "") or ""),
        lugar=str(datos.pop("lugar", "") or "")[:200],
        etiquetas=normalizar_lista(datos.pop("etiquetas", [])),
        personas=normalizar_lista(datos.pop("personas", [])),
        estado=datos.pop("estado", "por_revisar") if datos.get("estado") in ESTADOS else "por_revisar",
        album_id=datos.pop("album_id", None),
        ajustes={},
        vinculos=con_vinculo([], vinculo) if vinculo else [],
        subido_por=usuario_id,
    )
    # La huella perceptual, para encontrar sus parecidas (rikchay/parecidas.py).
    if foto.medio == "foto":
        from rikchay.parecidas import huella_de

        foto.hash_perceptual = await asyncio.to_thread(huella_de, rel)
    # Con GPS dentro de un lugar con nombre, entra en él (rikchay/lugares.py).
    from rikchay.lugares import asignar_si_cae

    await asignar_si_cae(sesion, foto)
    # Dos subidas a la vez con la misma foto (2026-10-20: un reintento mientras la primera seguía):
    # la otra la registró después de buscarla aquí. La huella es única, así que esta sale como
    # «ya estaba» y su copia en disco se retira, en vez de tumbar la tanda entera con un 500.
    from sqlalchemy.exc import IntegrityError

    try:
        async with sesion.begin_nested():
            sesion.add(foto)
            await sesion.flush()
    except IntegrityError:
        (raiz() / rel).unlink(missing_ok=True)
        otra = (await sesion.execute(select(Foto).where(Foto.sha256 == leido.sha256))).scalar_one_or_none()
        if otra is None:
            raise
        return otra, False
    return foto, True


async def version_editada(sesion, foto, usuario_id: int | None):
    """La versión de `foto` con sus ajustes aplicados, como registro propio de la Mediateca (la cita una
    semana, que imprime lo que se ve) y enlazada al original en `media_versiones`. Si ya existe una con
    esos mismos ajustes, la devuelve; si no, la exporta, la guarda con la fecha del original y la
    registra. No hace commit. Las versiones no salen sueltas en la lista (`condiciones`)."""
    import asyncio

    from sqlalchemy import select

    from rikchay.modelos import Foto, Version

    a = normalizar_ajustes(foto.ajustes)
    previas = (await sesion.execute(select(Version).where(Version.original_id == foto.id))).scalars().all()
    for v in previas:
        if clave_ajustes(v.ajustes) == clave_ajustes(a):
            derivada = await sesion.get(Foto, v.derivada_id)
            if derivada is not None and ruta_original(derivada.archivo).is_file():
                return derivada
    exportada = await asyncio.to_thread(exportar, foto.archivo, foto.sha256, a, "original")
    leido = await asyncio.to_thread(leer_archivo, exportada)
    existente = (await sesion.execute(select(Foto).where(Foto.sha256 == leido.sha256))).scalar_one_or_none()
    if existente is None:
        rel = await asyncio.to_thread(guardar_original, exportada, leido, False, foto.tomada_en)
        existente = Foto(
            sha256=leido.sha256, nombre_original=foto.nombre_original, archivo=rel, medio="foto", bytes=leido.bytes,
            ancho=leido.ancho, alto=leido.alto, tomada_en=foto.tomada_en, fecha_exif=foto.fecha_exif,
            fecha_fuente=foto.fecha_fuente, camara=foto.camara, lat=foto.lat, lon=foto.lon, exif={},
            titulo=foto.titulo, descripcion=foto.descripcion, lugar=foto.lugar, etiquetas=list(foto.etiquetas or []),
            personas=list(foto.personas or []), estado=foto.estado, album_id=foto.album_id, ajustes={},
            vinculos=[], subido_por=usuario_id, ambito=foto.ambito, categoria=foto.categoria,
        )
        sesion.add(existente)
        await sesion.flush()
    sesion.add(Version(original_id=foto.id, derivada_id=existente.id, tipo="edicion", ajustes=a))
    await sesion.flush()
    return existente


def estado_desde_semana(estado: str | None) -> str:
    """Estados de la semana (publica / reservada / revisar) → los de la Fototeca."""
    return {"publica": "publica", "reservada": "reservada"}.get(str(estado or ""), "por_revisar")


def estado_hacia_semana(estado: str | None) -> str:
    return {"publica": "publica", "reservada": "reservada"}.get(str(estado or ""), "revisar")


def ficha(foto, detalle: bool = False) -> dict:
    """La foto como la ve la web."""
    a = normalizar_ajustes(foto.ajustes)
    d = {
        "id": foto.id,
        "medio": foto.medio or "foto",
        "duracion": foto.duracion,
        "nombre_original": foto.nombre_original,
        "ancho": foto.ancho,
        "alto": foto.alto,
        "proporcion": proporcion(foto.ancho or 1, foto.alto or 1, a),
        "bytes": foto.bytes,
        "tomada_en": foto.tomada_en.astimezone(zona()).isoformat() if foto.tomada_en else None,
        "fecha_exif": foto.fecha_exif,
        "camara": foto.camara,
        "lat": foto.lat,
        "lon": foto.lon,
        "titulo": foto.titulo,
        "descripcion": foto.descripcion,
        "lugar": foto.lugar,
        "lugar_id": foto.lugar_id,
        "etiquetas": foto.etiquetas or [],
        "personas": foto.personas or [],
        "estado": foto.estado,
        "favorita": foto.favorita,
        "calificacion": foto.calificacion,
        "album_id": foto.album_id,
        "ajustes": a,
        "version": clave_ajustes(a),
        "vinculos": foto.vinculos or [],
        "eliminada_en": foto.eliminada_en.isoformat() if foto.eliminada_en else None,
        "archivo": foto.archivo,
        "ambito": foto.ambito or "actividad",
        "categoria": foto.categoria or "",
        "seleccion": foto.seleccion or "",
        "color": foto.color or "",
        "fecha_fuente": foto.fecha_fuente or "",
        "revisar_fecha": bool(foto.revisar_fecha),
    }
    if detalle:
        d.update({
            "exif": foto.exif or {},
            "sha256": foto.sha256,
            "subido_por": foto.subido_por,
            "creado_en": foto.creado_en.isoformat() if foto.creado_en else None,
        })
    return d
