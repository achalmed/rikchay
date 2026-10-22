"""Personas y sus caras en la Mediateca (2026-10-19; docs/plataforma/mediateca-central.md de Qillqa §2.2).

Como en digiKam: una persona aparece en una foto con su REGIÓN de cara (x, y, ancho, alto normalizados 0–1),
que sirve para verla marcada en el visor, recortarla («recortar por cara», el retrato de la persona) y, más
adelante, reconocerla. Reglas:

  - la región se mide sobre la foto girada según su EXIF y SIN ajustes (la vista «cruda»): un recorte o un giro
    del editor no mueve las caras ya marcadas;
  - el nombre de la persona vive también en la lista `personas` de la foto (lo que se busca y se cuenta): poner
    una cara lo añade; quitar la última cara de esa persona en la foto lo quita; quitar el nombre de la lista deja
    sus caras sin nombre («¿Quién es?»), no las borra;
  - la detección automática es opcional y solo PROPONE (rikchay/caras_detector.py): nada entra a la base sin
    que una persona le ponga nombre.

Las funciones puras van arriba y tienen prueba (tests/test_fototeca.py).
"""

from __future__ import annotations

import functools
import hashlib
import json
import subprocess
from pathlib import Path

from rikchay.config import config

MINIMO = 0.01  # una caja de menos del 1 % del lado no es una cara: es un clic sin arrastrar
ORIGENES = ("manual", "modelo")


# --- Puras -----------------------------------------------------------------------------------


def normalizar_caja(x: float, y: float, ancho: float, alto: float) -> tuple[float, float, float, float]:
    """La caja dentro de la foto (0–1). ValueError si es demasiado chica."""
    x0 = min(max(float(x), 0.0), 1.0)
    y0 = min(max(float(y), 0.0), 1.0)
    w = min(max(float(ancho), 0.0), 1.0 - x0)
    h = min(max(float(alto), 0.0), 1.0 - y0)
    if w < MINIMO or h < MINIMO:
        raise ValueError("La región de la cara es demasiado chica.")
    return round(x0, 5), round(y0, 5), round(w, 5), round(h, 5)


def caja_recorte(ancho: int, alto: int, caja: tuple[float, float, float, float], margen: float = 0.35) -> tuple[int, int, int, int]:
    """El cuadrado (izq, arriba, der, abajo, en píxeles) que encuadra la cara con aire alrededor, sin salir de la
    foto: si toca un borde, se corre hacia adentro en vez de achicarse."""
    x, y, w, h = caja
    cx, cy = (x + w / 2) * ancho, (y + h / 2) * alto
    lado = min(max(w * ancho, h * alto) * (1 + 2 * margen), ancho, alto)
    izq = min(max(cx - lado / 2, 0), ancho - lado)
    arr = min(max(cy - lado / 2, 0), alto - lado)
    return round(izq), round(arr), round(izq + lado), round(arr + lado)


def solapa(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """Intersección sobre unión de dos cajas (x, y, ancho, alto)."""
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def propuestas_nuevas(propuestas: list[dict], existentes: list[tuple], umbral: float = 0.35) -> list[dict]:
    """Las cajas del detector que no caen sobre una cara ya marcada."""
    def caja(d):
        return (d["x"], d["y"], d["ancho"], d["alto"])
    return [p for p in propuestas if all(solapa(caja(p), e) < umbral for e in existentes)]


def nombres_con(personas: list | None, nombre: str) -> list:
    if any(str(p).casefold() == nombre.casefold() for p in personas or []):
        return list(personas or [])
    return [*(personas or []), nombre]


def nombres_sin(personas: list | None, nombre: str) -> list:
    return [p for p in personas or [] if str(p).casefold() != nombre.casefold()]


def limpiar_nombre(nombre: str | None) -> str:
    return " ".join(str(nombre or "").split())[:200]


# --- Base -------------------------------------------------------------------------------------


async def persona_por_nombre(sesion, nombre: str):
    """La persona con ese nombre (sin distinguir mayúsculas); se crea si no existe."""
    from sqlalchemy import func, select

    from rikchay.modelos import Persona

    nombre = limpiar_nombre(nombre)
    hay = (await sesion.execute(select(Persona).where(func.lower(Persona.nombre) == nombre.lower()))).scalars().first()
    if hay is not None:
        return hay
    p = Persona(nombre=nombre)
    sesion.add(p)
    await sesion.flush()
    return p


def ficha_cara(cara, persona) -> dict:
    return {
        "id": cara.id, "foto_id": cara.foto_id, "persona_id": cara.persona_id, "persona": persona.nombre if persona else "",
        "x": cara.x, "y": cara.y, "ancho": cara.ancho, "alto": cara.alto, "confianza": cara.confianza, "origen": cara.origen,
    }


async def caras_de(sesion, foto_id: int) -> list[dict]:
    from sqlalchemy import select

    from rikchay.modelos import Cara, Persona

    filas = (await sesion.execute(
        select(Cara, Persona).outerjoin(Persona, Persona.id == Cara.persona_id).where(Cara.foto_id == foto_id).order_by(Cara.x)
    )).all()
    return [ficha_cara(c, p) for c, p in filas]


async def quedan_caras(sesion, foto_id: int, persona_id: int | None, salvo: int | None = None) -> bool:
    from sqlalchemy import func, select

    from rikchay.modelos import Cara

    if persona_id is None:
        return False
    c = select(func.count(Cara.id)).where(Cara.foto_id == foto_id, Cara.persona_id == persona_id)
    if salvo is not None:
        c = c.where(Cara.id != salvo)
    return (await sesion.execute(c)).scalar_one() > 0


async def soltar_caras_sin_nombre(sesion, foto) -> None:
    """Las caras cuya persona ya no está en la lista de la foto quedan sin nombre (no se borran)."""
    from sqlalchemy import select

    from rikchay.modelos import Cara, Persona

    nombres = {str(n).casefold() for n in foto.personas or []}
    filas = (await sesion.execute(
        select(Cara, Persona).join(Persona, Persona.id == Cara.persona_id).where(Cara.foto_id == foto.id)
    )).all()
    for cara, persona in filas:
        if persona.nombre.casefold() not in nombres:
            cara.persona_id = None


# --- Recorte por cara ---------------------------------------------------------------------------


def recorte(archivo: str, sha: str, caja: tuple[float, float, float, float], lado: int = 256) -> Path:
    """La cara recortada en cuadrado (JPEG, en caché): el retrato de la persona en esa foto."""
    from rikchay import fototeca as ft

    lado = max(64, min(int(lado), 1024))
    huella = hashlib.sha1(json.dumps([round(v, 4) for v in caja]).encode()).hexdigest()[:10]
    destino = ft.raiz() / "cache" / "caras" / sha[:2] / f"{sha}-{huella}-{lado}.jpg"
    if destino.is_file():
        return destino
    base = ft.abrir(ft.derivado(archivo, sha, {}, "crudo"))
    img = base.crop(caja_recorte(base.width, base.height, caja))
    if img.width > lado:
        img = img.resize((lado, lado), resample=3)  # LANCZOS
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".tmp")
    img.save(tmp, "JPEG", quality=86)
    tmp.replace(destino)
    return destino


# --- Detección (opcional) -----------------------------------------------------------------------


DETECTOR = Path(__file__).with_name("caras_detector.py")


def modelo() -> str:
    """El modelo de caras: `CARAS_MODELO`, o el YuNet que la Mediateca guarda en su carpeta (`modelos/`), o nada
    (la cascada de Haar de OpenCV 4). La Mediateca no lo toma de otro programa: se copia una vez a su carpeta."""
    if config.caras_modelo:
        return str(Path(config.caras_modelo).expanduser())
    from rikchay import fototeca as ft

    hallados = sorted((ft.raiz() / "modelos").glob("*yunet*.onnx")) if (ft.raiz() / "modelos").is_dir() else []
    return str(hallados[-1]) if hallados else ""


@functools.lru_cache(maxsize=1)
def detector() -> dict:
    """Si hay detector y cómo corre: con OpenCV dentro de la API, o con `CARAS_PYTHON` aparte."""
    m = modelo()
    if m and not Path(m).is_file():
        return {"disponible": False, "motivo": "El modelo de caras (CARAS_MODELO) no existe."}
    try:
        from rikchay import caras_detector

        tipo = caras_detector.puede(m)
        return {"disponible": True, "modo": "interno", "modelo": "YuNet" if tipo == "yunet" else "cascada de Haar"}
    except ImportError:
        motivo = "OpenCV no está instalado (la detección es opcional)."
    except ValueError as e:
        motivo = str(e)
    if config.caras_python:
        try:
            r = subprocess.run([config.caras_python, "-I", str(DETECTOR), "--probar", m], capture_output=True, text=True,
                               timeout=30)
            if r.returncode == 0:
                tipo = r.stdout.strip()
                return {"disponible": True, "modo": "externo", "modelo": "YuNet" if tipo == "yunet" else "cascada de Haar"}
            motivo = (r.stderr.strip().splitlines() or [motivo])[-1]
        except (OSError, subprocess.TimeoutExpired):
            pass
    return {"disponible": False, "motivo": motivo}


def detectar(ruta: Path) -> list[dict]:
    """Las caras que propone el detector sobre `ruta` (la vista cruda). RuntimeError si no hay detector."""
    estado = detector()
    if not estado.get("disponible"):
        raise RuntimeError(estado.get("motivo") or "No hay detector de caras.")
    m = modelo()
    if estado["modo"] == "interno":
        from rikchay import caras_detector

        return caras_detector.detectar(str(ruta), m)
    r = subprocess.run([config.caras_python, "-I", str(DETECTOR), str(ruta), m], capture_output=True, text=True,
                       timeout=120)
    if r.returncode != 0:
        raise RuntimeError(((r.stderr or "").strip().splitlines() or ["El detector falló."])[-1][:300])
    return json.loads(r.stdout or "[]")
