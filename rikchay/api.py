"""API de las fotografías de la entidad (2026-10-06; rikchay/fototeca.py).

Lista con filtros y facetas, subida múltiple con detección de duplicados, original /
vista / miniatura (todas por `enviar_archivo`), edición no destructiva, cambios en
lote, exportación por tamaños, papelera sin borrado físico, álbumes y la importación
de las fotos que ya estaban en los bancos de las semanas de representación.

Videos (2026-10-06): se suben y se listan como las fotos (`medio=video`), con su póster
como miniatura; no se editan ni se exportan por tamaños (se descarga el original). El
navegador los reproduce desde `GET /{id}/video?firma=…`: un enlace firmado y de vida
corta que da `GET /{id}/enlace-video` (un <video> no puede mandar el token), servido por
`enviar_archivo` con Range para poder adelantar.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from rikchay.modelos import BANDEJA, AlbumFoto, Cara, Foto, Lugar, Persona, Version
from rikchay import caras as cr
from rikchay import fototeca as ft
from rikchay import lugares as lg
from rikchay import parecidas as pr
from rikchay.config import config
from rikchay.db import obtener_sesion_mediateca
from tiqsi.bandeja_sql import guardar as guardar_evento
from tiqsi.modulo import capacidad, opcional, resolver
from tiqsi.puertos import Usuario, solo_administrador, usuario_actual
from tiqsi.web import enviar_archivo

# Lo que la Mediateca usa de otros, por el contrato (fase 10.2b): no importa nada de la plataforma ni de otro
# módulo. APROVECHA la Semana de representación («semanas.v1»: citar fotos en una semana, álbum de actividad,
# bancos viejos) y las etiquetas de lo vinculado («etiquetas.v1»); sin ellas (la Mediateca sola), esas partes
# no se ofrecen o muestran lo guardado. La identidad es un puerto de Tiqsi que conecta el anfitrión.

router = APIRouter(prefix="/api/fototeca", tags=["fototeca"])

MEDIA = {"jpg": "image/jpeg", "webp": "image/webp", "png": "image/png", "tif": "image/tiff", "heic": "image/heic",
         **{k.lstrip("."): v for k, v in ft.MEDIA_VIDEO.items()}}
# Enlace firmado de un video: audiencia propia (no sirve como token de la API) y vida corta.
AUDIENCIA_VIDEO = "fototeca-video"
HORAS_ENLACE = 4


def firmar_video(foto_id: int, ahora: datetime | None = None) -> str:
    ahora = ahora or datetime.now(timezone.utc)
    carga = {"sub": str(foto_id), "aud": AUDIENCIA_VIDEO, "iat": ahora, "exp": ahora + timedelta(hours=HORAS_ENLACE)}
    return jwt.encode(carga, config.jwt_secret, algorithm="HS256")


def leer_firma_video(firma: str | None) -> int | None:
    """El id de la foto de un enlace válido, o None (falta, vencido, alterado o de otro uso)."""
    if not firma:
        return None
    try:
        carga = jwt.decode(firma, config.jwt_secret, algorithms=["HS256"], audience=AUDIENCIA_VIDEO,
                           options={"require": ["exp", "sub", "aud"]})
    except jwt.InvalidTokenError:
        return None
    sub = str(carga.get("sub") or "")
    return int(sub) if sub.isdigit() else None


def _puede_escribir(u: Usuario) -> None:
    if u.rol == "invitado":
        raise HTTPException(403, "La cuenta de invitado solo puede consultar.")


async def _foto(sesion: AsyncSession, foto_id: int, papelera_ok: bool = True) -> Foto:
    foto = await sesion.get(Foto, foto_id)
    if foto is None or (not papelera_ok and foto.eliminada_en is not None):
        raise HTTPException(404, "Foto no encontrada.")
    return foto


async def _en_hilo(fn, *args):
    """Pillow trabaja en un hilo (no bloquea la API) y sus fallos son 4xx/5xx legibles."""
    try:
        return await asyncio.to_thread(fn, *args)
    except ft.ErrorFototeca as e:
        raise HTTPException(422, str(e))
    except FileNotFoundError:
        raise HTTPException(404, "El original no está en la Fototeca.")


# --- Lista, facetas y vocabularios ----------------------------------------------------------


def filtros_de_consulta(
    q: str = "",
    album: str = "",
    etiqueta: str = "",
    persona: str = "",
    estado: str = "",
    favorita: bool = False,
    desde: str = "",
    hasta: str = "",
    mes: str = "",
    vinculo: str = "",
    papelera: bool = False,
    medio: str = "",
    ambito: str = "actividad",
    categoria: str = "",
    seleccion: str = "",
    color: str = "",
    anio: str = "",
    lugar: str = "",
    calificacion: str = "",
    camara: str = "",
    uso: str = "",
    ids: str = "",
) -> ft.Filtros:
    """Los filtros de la dirección (la lista y sus facetas leen los mismos)."""
    return ft.leer_filtros(q, album, etiqueta, persona, estado, favorita, desde, hasta, mes, vinculo, papelera, medio,
                           ambito, categoria, seleccion=seleccion, color=color, anio=anio, lugar=lugar,
                           calificacion=calificacion, camara=camara, uso=uso, ids=ids)


@router.get("")
async def listar(
    f: ft.Filtros = Depends(filtros_de_consulta),
    orden: str = "reciente",
    limite: int = 120,
    desde_n: int = 0,
    _: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Una página de fotos (`desde_n`, `limite` ≤ 500) y el total con esos filtros.
    `medio=foto|video` filtra por tipo (el selector de fotos de otros módulos pide solo fotos)."""
    cond = ft.condiciones(f)
    limite = max(1, min(500, limite))
    total = (await sesion.execute(select(func.count(Foto.id)).where(*cond))).scalar_one()
    filas = (await sesion.execute(
        select(Foto).where(*cond).order_by(*ft.orden(orden)).offset(max(0, desde_n)).limit(limite)
    )).scalars().all()
    siguiente = desde_n + len(filas)
    fichas = [ft.ficha(x) for x in filas]
    await _con_versiones(sesion, fichas)
    return {"fotos": await _vigentes(fichas), "total": total,
            "siguiente": siguiente if siguiente < total else None}


async def _con_versiones(sesion: AsyncSession, fichas: list[dict]) -> None:
    """Cuántas versiones editadas tiene cada original (la cuadrícula lo marca; el visor las muestra)."""
    ids = [f["id"] for f in fichas]
    if not ids:
        return
    cuentas = dict((await sesion.execute(
        select(Version.original_id, func.count(Version.id)).where(Version.original_id.in_(ids)).group_by(Version.original_id)
    )).all())
    for f in fichas:
        f["n_versiones"] = cuentas.get(f["id"], 0)


@router.get("/facetas/busqueda")
async def facetas_busqueda(
    f: ft.Filtros = Depends(filtros_de_consulta),
    _: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """La búsqueda facetada (2026-10-19): por cada faceta (año, ámbito, selección, color, calificación, etiqueta,
    persona, lugar, cámara, medio, uso), cuántas fotos quedan con cada valor junto con los DEMÁS filtros puestos."""
    salida = {}
    for nombre, consulta in ft.consultas_facetas(f).items():
        filas = (await sesion.execute(consulta)).all()
        salida[nombre] = [{"valor": "ninguna" if nombre == "seleccion" and v == "" else v, "n": n} for v, n in filas]
    return salida


@router.get("/facetas")
async def facetas(
    _: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Los contadores del panel: totales, álbumes, etiquetas, personas, meses y vínculos."""
    tz = config.zona_horaria
    # Lo que cuenta el panel: fotos y videos de actividades, sin las versiones editadas (se ven desde su
    # original) ni los activos de marca (su propia sección, `marca`).
    v = "ambito = 'actividad' AND id NOT IN (SELECT derivada_id FROM media_versiones)"
    tot = (await sesion.execute(text(
        "SELECT count(*) FILTER (WHERE eliminada_en IS NULL), "
        "count(*) FILTER (WHERE eliminada_en IS NULL AND estado = 'por_revisar'), "
        "count(*) FILTER (WHERE eliminada_en IS NULL AND favorita), "
        "count(*) FILTER (WHERE eliminada_en IS NULL AND album_id IS NULL), "
        "count(*) FILTER (WHERE eliminada_en IS NOT NULL), "
        "count(*) FILTER (WHERE eliminada_en IS NULL AND medio = 'video') FROM fototeca_fotos WHERE " + v
    ))).one()
    # La depuración (aceptada / pendiente / rechazada / sin marcar) y las etiquetas de color.
    depuracion = (await sesion.execute(text(
        f"SELECT seleccion, count(*) FROM fototeca_fotos WHERE eliminada_en IS NULL AND {v} GROUP BY seleccion"
    ))).all()
    colores = (await sesion.execute(text(
        f"SELECT color, count(*) FROM fototeca_fotos WHERE eliminada_en IS NULL AND color <> '' AND {v} "
        "GROUP BY color ORDER BY count(*) DESC"
    ))).all()
    marca = (await sesion.execute(text(
        "SELECT categoria, count(*) FROM fototeca_fotos WHERE ambito = 'marca' AND eliminada_en IS NULL "
        "GROUP BY categoria ORDER BY categoria"
    ))).all()
    # Lo que produce Prensa (2026-10-20): su propio panel, por formato (post, historia, portada, video).
    prensa = (await sesion.execute(text(
        "SELECT categoria, count(*) FROM fototeca_fotos WHERE ambito = 'prensa' AND eliminada_en IS NULL "
        "GROUP BY categoria ORDER BY categoria"
    ))).all()
    albumes = (await sesion.execute(text(
        "SELECT a.id, a.nombre, a.descripcion, a.fecha, a.portada_id, "
        "count(f.id) FILTER (WHERE f.eliminada_en IS NULL) AS n, "
        "(SELECT min(g.id) FROM fototeca_fotos g WHERE g.album_id = a.id AND g.eliminada_en IS NULL) AS primera "
        "FROM fototeca_albumes a LEFT JOIN fototeca_fotos f ON f.album_id = a.id "
        "GROUP BY a.id ORDER BY a.fecha DESC, a.nombre"
    ))).all()

    async def _lista(columna: str) -> list[dict]:
        filas = (await sesion.execute(text(
            f"SELECT e, count(*) FROM fototeca_fotos, jsonb_array_elements_text({columna}) e "
            f"WHERE eliminada_en IS NULL AND {v} GROUP BY e ORDER BY count(*) DESC, e LIMIT 300"
        ))).all()
        return [{"valor": v, "n": n} for v, n in filas]

    meses = (await sesion.execute(text(
        "SELECT to_char(timezone(:tz, tomada_en), 'YYYY-MM') m, count(*) FROM fototeca_fotos "
        f"WHERE eliminada_en IS NULL AND {v} GROUP BY m ORDER BY m DESC"
    ), {"tz": tz})).all()
    vinculos = (await sesion.execute(text(
        "SELECT v->>'tipo', (v->>'id')::int, max(v->>'etiqueta'), count(*) FROM fototeca_fotos, "
        "jsonb_array_elements(vinculos) v WHERE eliminada_en IS NULL AND v ? 'id' "
        "GROUP BY 1, 2 ORDER BY 1, 2 DESC"
    ))).all()
    return {
        "total": tot[0], "por_revisar": tot[1], "favoritas": tot[2], "sin_album": tot[3], "papelera": tot[4],
        "videos": tot[5],
        "seleccion": {(s or "ninguna"): n for s, n in depuracion},
        "colores": [{"color": c, "n": n} for c, n in colores],
        "marca": [{"categoria": c or "otros", "n": n} for c, n in marca],
        "prensa": [{"categoria": c or "post", "n": n} for c, n in prensa],
        "albumes": [{"id": a.id, "nombre": a.nombre, "descripcion": a.descripcion, "fecha": a.fecha,
                     "portada_id": a.portada_id or a.primera, "n": a.n} for a in albumes],
        "etiquetas": await _lista("etiquetas"),
        "personas": await _lista("personas"),
        "meses": [{"mes": m, "n": n} for m, n in meses],
        "vinculos": await _vigentes_resumen(vinculos),
    }


async def _cortas(claves: set[str]) -> dict[str, str]:
    """La etiqueta corta y vigente de cada clave («documento:12» → «OF-0012»), si el anfitrión ofrece
    «etiquetas.v1»; si no (la Mediateca sola), ninguna: se muestra la guardada al vincular."""
    etiquetas = opcional("etiquetas.v1")
    return await etiquetas.cortas_de(claves) if (etiquetas is not None and claves) else {}


async def _vigentes(fichas: list[dict]) -> list[dict]:
    """Los vínculos de cada foto con la etiqueta VIGENTE de lo vinculado (2026-10-12): la guardada
    («OF (borrador 95)») era una copia del momento de vincular. Si ya no existe, queda la guardada."""
    claves = {f"{v.get('tipo')}:{v.get('id')}" for f in fichas for v in f.get("vinculos") or [] if v.get("id") is not None}
    vigentes = await _cortas(claves)
    for f in fichas:
        f["vinculos"] = [{**v, "etiqueta": vigentes.get(f"{v.get('tipo')}:{v.get('id')}", v.get("etiqueta") or "")}
                         for v in f.get("vinculos") or []]
    return fichas


async def _vigentes_resumen(vinculos) -> list[dict]:
    vigentes = await _cortas({f"{t}:{i}" for t, i, _, _ in vinculos})
    return [{"tipo": t, "id": i, "etiqueta": vigentes.get(f"{t}:{i}") or e or f"{t} {i}", "n": n} for t, i, e, n in vinculos]


@router.get("/presets")
async def presets(_: Usuario = Depends(usuario_actual)) -> list[dict]:
    return [{"clave": k, "etiqueta": v["etiqueta"], "proporcion": v["proporcion"]} for k, v in ft.PRESETS.items()]


# --- Subida -----------------------------------------------------------------------------------


class Huellas(BaseModel):
    sha256: list[str] = Field(default_factory=list, max_length=2000)


@router.post("/existen")
async def existen(
    datos: Huellas,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Cuáles de estas huellas (SHA-256 del archivo, calculadas en el navegador) ya están en la
    Mediateca (2026-10-20, como Google Fotos): lo que ya está no se vuelve a enviar. Responde
    {huella: {id, en_papelera}} solo con las que están."""
    _puede_escribir(usuario)
    pedidas = {h.strip().lower() for h in datos.sha256 if len(h.strip()) == 64}
    if not pedidas:
        return {"existen": {}}
    filas = (await sesion.execute(
        select(Foto.sha256, Foto.id, Foto.eliminada_en).where(Foto.sha256.in_(pedidas))
    )).all()
    return {"existen": {sha: {"id": i, "en_papelera": e is not None} for sha, i, e in filas}}


async def _a_la_semana(ids: list[int], semana_id: int | None, actividad: str, usuario: Usuario, sesion: AsyncSession):
    """Las fotos subidas (o que ya estaban) de una Semana de Representación pasan a su banco, por «semanas.v1» (la
    Mediateca no importa la Semana, fase 10.2b); sin ella, nada."""
    semanas = opcional("semanas.v1")
    if semana_id is None or not ids or semanas is None:
        return None
    return await semanas.citar_fotos(semana_id, ids, actividad.strip(), usuario, sesion)


class Asociar(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=2000)
    album_id: int | None = None
    semana_id: int | None = None
    actividad: str = ""


@router.post("/asociar")
async def asociar(
    datos: Asociar,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Lo que `subir` hace con una repetida, sin volver a enviarla: las que ya estaban y se
    eligieron para un álbum o una semana entran en él (si no tenían álbum) y en el banco de la
    semana. Las de la papelera no se tocan."""
    _puede_escribir(usuario)
    album_id = datos.album_id
    if album_id is not None and await sesion.get(AlbumFoto, album_id) is None:
        raise HTTPException(404, "Álbum no encontrado.")
    if album_id is None and datos.semana_id is not None and datos.actividad.strip():
        album_id = await _album_de_actividad(sesion, datos.semana_id, datos.actividad.strip(), usuario.id)
    fotos = (await sesion.execute(
        select(Foto).where(Foto.id.in_(datos.ids), Foto.eliminada_en.is_(None))
    )).scalars().all()
    for f in fotos:
        if album_id and not f.album_id:
            f.album_id = album_id
    await sesion.commit()
    semana = await _a_la_semana([f.id for f in fotos], datos.semana_id, datos.actividad, usuario, sesion)
    return {"asociadas": len(fotos), "semana": semana}


async def _album_de_actividad(sesion: AsyncSession, semana_id: int, actividad: str, usuario_id: int) -> int | None:
    """El álbum de una actividad de una semana de representación («SR-05 · A-01 · Visita a la
    UGEL»); se crea si no existe. None si la semana no está (o si no hay Semana: «semanas.v1»)."""
    semanas = opcional("semanas.v1")
    a = await semanas.actividad(semana_id, actividad) if semanas is not None else None
    if a is None:
        return None
    titulo = a["titulo"]
    nombre = " · ".join(x for x in (a["semana"], actividad, titulo) if x)[:200]
    existente = (await sesion.execute(select(AlbumFoto).where(AlbumFoto.nombre == nombre))).scalars().first()
    if existente:
        return existente.id
    album = AlbumFoto(nombre=nombre, fecha=a["fecha"], creado_por=usuario_id,
                      descripcion=f"Actividad {actividad} de la semana {a['semana']}")
    sesion.add(album)
    await sesion.flush()
    return album.id


@router.post("/subir")
async def subir(
    archivos: list[UploadFile] = File(...),
    album_id: int | None = Form(None),
    semana_id: int | None = Form(None),
    actividad: str = Form(""),
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Varias fotos (o videos) a la vez. Cada original se guarda una vez: las repetidas (por
    su contenido, no por su nombre) se informan en `duplicadas` y no se vuelven a guardar.

    Con `semana_id` (y `actividad`), son fotos de una Semana de Representación (2026-10-10):
    además de entrar aquí, pasan al banco de trabajo de esa semana —la carpeta donde se
    procesan y eligen para el informe— y quedan registradas en su actividad. La Fototeca sigue
    siendo la única biblioteca; el banco es su copia de trabajo."""
    _puede_escribir(usuario)
    if album_id is not None and await sesion.get(AlbumFoto, album_id) is None:
        raise HTTPException(404, "Álbum no encontrado.")
    # Sin álbum ni semana entran sueltas, ordenadas por su fecha (Edison 2026-10-20: «subir las
    # fotos así nada más»). Las de una actividad de una semana van a un álbum propio
    # «SR-NN · A-NN · título» (se crea la primera vez), así la Mediateca las agrupa igual que el
    # banco de la semana.
    if album_id is None and semana_id is not None and actividad.strip():
        album_id = await _album_de_actividad(sesion, semana_id, actividad.strip(), usuario.id)
    nuevas, duplicadas, rechazadas = [], [], []
    tmp_dir = ft.carpeta_temporal()
    for archivo in archivos:
        nombre = Path(archivo.filename or "foto.jpg").name
        if not ft.admitido(nombre):
            rechazadas.append({"nombre": nombre, "motivo": "No es una foto (JPG, PNG, WEBP, HEIC, AVIF o TIFF) ni un video (MP4, MOV o WEBM)."})
            continue
        maximo = ft.MAX_VIDEO if ft.es_video(nombre) else ft.MAX_FOTO
        tmp = tmp_dir / f"{uuid.uuid4().hex}{Path(nombre).suffix.lower()}"
        tam = 0
        with tmp.open("wb") as fh:
            while trozo := await archivo.read(1024 * 1024):
                tam += len(trozo)
                if tam > maximo:
                    break
                fh.write(trozo)
        if tam > maximo:
            tmp.unlink(missing_ok=True)
            rechazadas.append({"nombre": nombre, "motivo": f"Pesa más de {maximo // 1024 // 1024} MB."})
            continue
        try:
            foto, nueva = await ft.registrar(sesion, tmp, nombre, usuario.id, mover=True,
                                             datos={"album_id": album_id})
        except ft.ErrorFototeca as e:
            tmp.unlink(missing_ok=True)
            rechazadas.append({"nombre": nombre, "motivo": str(e)})
            continue
        # Cada foto se confirma al llegar: si la conexión se corta a mitad de la tanda, lo ya
        # recibido queda (y la siguiente vez sale como «ya estaba») en vez de perderse.
        await sesion.commit()
        if nueva:
            nuevas.append(foto)
            # En la misma transacción que la foto: si no se guarda, no se cuenta (fase 10.2b).
            await guardar_evento(sesion, BANDEJA, "fototeca.foto.subida",
                                 {"id": foto.id, "album_id": album_id, "usuario_id": usuario.id}, origen="fototeca")
        else:
            duplicadas.append({"nombre": nombre, "id": foto.id, "en_papelera": foto.eliminada_en is not None})
    await sesion.commit()
    ids_semana = [x.id for x in nuevas] + [d["id"] for d in duplicadas if not d["en_papelera"]]
    semana_resultado = await _a_la_semana(ids_semana, semana_id, actividad, usuario, sesion)
    return {"nuevas": [ft.ficha(x) for x in nuevas], "duplicadas": duplicadas, "rechazadas": rechazadas,
            "semana": semana_resultado}


# --- Cambios en lote y exportación múltiple (antes de /{foto_id}) --------------------------


class Lote(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=2000)
    etiquetas_agregar: list[str] = Field(default_factory=list)
    etiquetas_quitar: list[str] = Field(default_factory=list)
    personas_agregar: list[str] = Field(default_factory=list)
    personas_quitar: list[str] = Field(default_factory=list)
    # Presente (aunque sea null) = mover a ese álbum o sacar del álbum.
    album_id: int | None = None
    estado: str | None = None
    favorita: bool | None = None
    calificacion: int | None = Field(default=None, ge=0, le=5)
    lugar: str | None = None
    # Presente (aunque sea null) = poner en ese lugar con nombre o sacar de él.
    lugar_id: int | None = None
    # Depuración como en digiKam: '' (sin marca) | aceptada | pendiente | rechazada; y la etiqueta de color.
    seleccion: str | None = None
    color: str | None = None
    # True = a la papelera; False = restaurar.
    papelera: bool | None = None


def _depuracion(seleccion: str | None, color: str | None) -> None:
    if seleccion is not None and seleccion not in ft.SELECCIONES:
        raise HTTPException(422, "Selección desconocida (aceptada, pendiente o rechazada).")
    if color is not None and color not in ft.COLORES:
        raise HTTPException(422, "Color desconocido.")


def _quitar(lista: list, quitar: list[str]) -> list:
    fuera = {q.casefold() for q in quitar}
    return [x for x in lista if str(x).casefold() not in fuera]


@router.patch("/lote")
async def cambiar_lote(
    datos: Lote,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    _puede_escribir(usuario)
    if datos.estado is not None and datos.estado not in ft.ESTADOS:
        raise HTTPException(422, "Estado desconocido.")
    _depuracion(datos.seleccion, datos.color)
    lugar_lote = await _lugar(sesion, datos.lugar_id) if "lugar_id" in datos.model_fields_set and datos.lugar_id else None
    if "album_id" in datos.model_fields_set and datos.album_id is not None \
            and await sesion.get(AlbumFoto, datos.album_id) is None:
        raise HTTPException(404, "Álbum no encontrado.")
    fotos = (await sesion.execute(select(Foto).where(Foto.id.in_(datos.ids)))).scalars().all()
    ahora = datetime.now().astimezone()
    for f in fotos:
        if datos.etiquetas_agregar or datos.etiquetas_quitar:
            f.etiquetas = ft.normalizar_lista(_quitar(f.etiquetas or [], datos.etiquetas_quitar) + datos.etiquetas_agregar)
        if datos.personas_agregar or datos.personas_quitar:
            f.personas = ft.normalizar_lista(_quitar(f.personas or [], datos.personas_quitar) + datos.personas_agregar)
            if datos.personas_quitar:
                await cr.soltar_caras_sin_nombre(sesion, f)
        if "album_id" in datos.model_fields_set:
            f.album_id = datos.album_id
        if datos.estado is not None:
            f.estado = datos.estado
        if datos.favorita is not None:
            f.favorita = datos.favorita
        if datos.calificacion is not None:
            f.calificacion = datos.calificacion
        if datos.lugar is not None:
            f.lugar = datos.lugar.strip()[:200]
            f.lugar_id = None
        if "lugar_id" in datos.model_fields_set:
            f.lugar_id = lugar_lote.id if lugar_lote else None
            if lugar_lote:
                f.lugar = lugar_lote.nombre
        if datos.seleccion is not None:
            f.seleccion = datos.seleccion
        if datos.color is not None:
            f.color = datos.color
        if datos.papelera is not None:
            f.eliminada_en = ahora if datos.papelera else None
    await sesion.commit()
    return {"cambiadas": len(fotos)}


class Exportar(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    preset: str = "original"
    formato: str = "jpg"


@router.post("/exportar")
async def exportar_lote(
    datos: Exportar,
    peticion: Request,
    _: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> Response:
    """Una foto: el archivo exportado; varias: un .zip con todas (con sus ajustes). Un
    video va tal cual (su original): no tiene tamaños de exportación."""
    fotos = (await sesion.execute(select(Foto).where(Foto.id.in_(datos.ids)).order_by(Foto.tomada_en))).scalars().all()
    if not fotos:
        raise HTTPException(404, "Ninguna de esas fotos existe.")
    entradas = []
    for f in fotos:
        if f.medio == "video":
            ruta = ft.ruta_original(f.archivo)
            if not ruta.is_file():
                raise HTTPException(404, "El original no está en la Fototeca.")
            entradas.append((ruta, f.nombre_original or ruta.name))
            continue
        ruta = await _en_hilo(ft.exportar, f.archivo, f.sha256, f.ajustes, datos.preset, datos.formato)
        entradas.append((ruta, ft.nombre_exportado(f.nombre_original, f.titulo, datos.preset, datos.formato)))
    if len(entradas) == 1:
        media = MEDIA.get(entradas[0][0].suffix.lstrip(".").lower(), MEDIA[datos.formato])
        return enviar_archivo(entradas[0][0], entradas[0][1], media_type=media, peticion=peticion)
    zip_ = await asyncio.to_thread(ft.armar_zip, entradas)
    return enviar_archivo(zip_, zip_.name, media_type="application/zip")


# --- Álbumes ------------------------------------------------------------------------------


class DatosAlbum(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)
    descripcion: str = ""
    fecha: str = Field(default="", max_length=10)
    portada_id: int | None = None


def _album(a: AlbumFoto) -> dict:
    return {"id": a.id, "nombre": a.nombre, "descripcion": a.descripcion, "fecha": a.fecha, "portada_id": a.portada_id}


@router.get("/albumes")
async def albumes(_: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> list[dict]:
    filas = (await sesion.execute(select(AlbumFoto).order_by(AlbumFoto.fecha.desc(), AlbumFoto.nombre))).scalars().all()
    return [_album(a) for a in filas]


@router.post("/albumes")
async def crear_album(
    datos: DatosAlbum,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    _puede_escribir(usuario)
    a = AlbumFoto(nombre=datos.nombre.strip(), descripcion=datos.descripcion.strip(), fecha=datos.fecha,
                  portada_id=datos.portada_id, creado_por=usuario.id)
    sesion.add(a)
    await sesion.commit()
    return _album(a)


@router.patch("/albumes/{album_id}")
async def cambiar_album(
    album_id: int,
    datos: DatosAlbum,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    _puede_escribir(usuario)
    a = await sesion.get(AlbumFoto, album_id)
    if a is None:
        raise HTTPException(404, "Álbum no encontrado.")
    a.nombre, a.descripcion, a.fecha = datos.nombre.strip(), datos.descripcion.strip(), datos.fecha
    if "portada_id" in datos.model_fields_set:
        a.portada_id = datos.portada_id
    await sesion.commit()
    return _album(a)


@router.delete("/albumes/{album_id}")
async def quitar_album(
    album_id: int,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Quita el álbum; sus fotos se quedan en la Fototeca, sin álbum."""
    _puede_escribir(usuario)
    a = await sesion.get(AlbumFoto, album_id)
    if a is None:
        raise HTTPException(404, "Álbum no encontrado.")
    await sesion.execute(update(Foto).where(Foto.album_id == album_id).values(album_id=None))
    await sesion.delete(a)
    await sesion.commit()
    return {"ok": True}


# --- Importar los bancos de las semanas ------------------------------------------------------


@router.post("/importar-semanas")
async def importar_semanas(
    crear_albumes: bool = True,
    semana_id: int | None = None,
    usuario: Usuario = Depends(solo_administrador),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Trae a la Fototeca las fotos de los bancos de TODAS las semanas de representación.

    Idempotente: una foto ya traída (misma huella) solo gana el vínculo con la semana que
    le falte; lo corregido en la Fototeca no se pisa. El banco de la semana no se toca (el
    informe sigue leyendo de él). Con `crear_albumes`, cada semana tiene su álbum; con
    `semana_id`, solo esa semana."""
    return await importar_bancos(sesion, usuario.id, crear_albumes, semana_id)


async def importar_bancos(sesion: AsyncSession, usuario_id: int | None, crear_albumes: bool = True,
                          semana_id: int | None = None) -> dict:
    semanas = opcional("semanas.v1")
    if semanas is None:
        raise HTTPException(409, "Sin la Semana de representación no hay bancos que importar.")
    resumen = {"semanas": 0, "nuevas": 0, "ya_estaban": 0, "sin_original": 0, "errores": []}
    for semana in await semanas.bancos(semana_id):
        banco = Path(semana["banco"]).expanduser()
        resumen["semanas"] += 1
        tema = semana["tema"]
        album_nombre = f"{semana['codigo']} · {tema}" if tema else semana["codigo"]
        etiqueta = semana["codigo"]
        album_id = None
        if crear_albumes:
            album = (await sesion.execute(select(AlbumFoto).where(AlbumFoto.nombre == album_nombre))).scalar_one_or_none()
            if album is None:
                album = AlbumFoto(nombre=album_nombre, descripcion="Fotos del banco de la semana de representación.",
                                  fecha=semana["inicio"], creado_por=usuario_id)
                sesion.add(album)
                await sesion.flush()
            album_id = album.id
        for fsr in semana["fotos"]:
            d = fsr["datos"]
            vinculo = {"tipo": "semana", "id": semana["id"], "codigo": fsr["codigo"], "etiqueta": etiqueta,
                       "seleccion": bool(d.get("seleccion")) or None}
            # Llegó DESDE la Fototeca (quizá con ajustes, es decir, otro archivo): solo el vínculo.
            if d.get("fototeca_id"):
                origen = await sesion.get(Foto, int(d["fototeca_id"]))
                if origen is not None:
                    origen.vinculos = ft.con_vinculo(origen.vinculos, vinculo)
                    resumen["ya_estaban"] += 1
                    continue
            ruta = (banco / str(d.get("origen") or "")).resolve()
            if not d.get("origen") or not ruta.is_file():
                resumen["sin_original"] += 1
                continue
            try:
                _, nueva = await ft.registrar(
                    sesion, ruta, ruta.name, usuario_id, vinculo=vinculo,
                    datos={"descripcion": str(d.get("pie") or ""), "estado": ft.estado_desde_semana(d.get("estado")),
                           "album_id": album_id, "etiquetas": ["Semana de representación"]},
                )
            except ft.ErrorFototeca as e:
                resumen["errores"].append(f"{semana['codigo']} {fsr['codigo']}: {e}")
                continue
            resumen["nuevas" if nueva else "ya_estaban"] += 1
        await sesion.commit()
    return resumen


# --- Parecidas por huella perceptual (2026-10-20; rikchay/parecidas.py) ------------------------


@router.get("/parecidas")
async def parecidas(
    umbral: str = "parecidas",
    calcular: bool = True,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Los grupos de fotos que se ven casi iguales. Antes calcula una tanda de huellas que falten: si `faltan` > 0,
    la web vuelve a pedir (así se ve el avance y ninguna petición tarda mucho)."""
    calculadas, faltan = (0, 0)
    if calcular and usuario.rol != "invitado":
        calculadas, faltan = await pr.calcular_tanda(sesion)
    bits = pr.UMBRALES.get(umbral, pr.UMBRALES["parecidas"])
    lista = []
    for g in await pr.grupos(sesion, bits):
        fichas = [ft.ficha(f) for f in g]
        await _con_versiones(sesion, fichas)
        lista.append({"fotos": await _vigentes(fichas),
                      "distancia": max(pr.distancia(a.hash_perceptual, b.hash_perceptual) for a in g for b in g)})
    return {"grupos": lista, "calculadas": calculadas, "faltan": faltan, "umbral": bits}


# --- Mapa y lugares con nombre (2026-10-19; rikchay/lugares.py) -------------------------------


async def _lugar(sesion: AsyncSession, lugar_id: int) -> Lugar:
    lugar = await sesion.get(Lugar, lugar_id)
    if lugar is None:
        raise HTTPException(404, "Lugar no encontrado.")
    return lugar


@router.get("/mapa")
async def mapa(
    f: ft.Filtros = Depends(filtros_de_consulta),
    _: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Las fotos con GPS de la vista (los mismos filtros de la lista): [id, lat, lon, versión de la miniatura]."""
    cond = ft.condiciones(f)
    filas = (await sesion.execute(
        select(Foto.id, Foto.lat, Foto.lon, Foto.ajustes).where(*cond, Foto.lat.isnot(None), Foto.lon.isnot(None))
        .order_by(*ft.orden("reciente")).limit(5000)
    )).all()
    sin = (await sesion.execute(select(func.count(Foto.id)).where(*cond, Foto.lat.is_(None)))).scalar_one()
    return {"puntos": [[i, la, lo, ft.clave_ajustes(ft.normalizar_ajustes(a))] for i, la, lo, a in filas], "sin_gps": sin}


class DatosLugar(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    radio_m: int = Field(default=200, ge=lg.RADIO_MIN, le=lg.RADIO_MAX)


def _ficha_lugar(l: Lugar, n: int = 0) -> dict:
    return {"id": l.id, "nombre": l.nombre, "lat": l.lat, "lon": l.lon, "radio_m": l.radio_m, "n": n}


@router.get("/lugares")
async def lugares(_: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> list[dict]:
    filas = (await sesion.execute(
        select(Lugar, func.count(Foto.id)).outerjoin(Foto, (Foto.lugar_id == Lugar.id) & Foto.eliminada_en.is_(None))
        .group_by(Lugar.id).order_by(Lugar.nombre)
    )).all()
    return [_ficha_lugar(l, n) for l, n in filas]


async def _nombre_libre(sesion: AsyncSession, nombre: str, salvo: int | None = None) -> str:
    nombre = " ".join(nombre.split())
    otro = (await sesion.execute(select(Lugar).where(func.lower(Lugar.nombre) == nombre.lower()))).scalars().first()
    if otro is not None and otro.id != salvo:
        raise HTTPException(409, f"Ya hay un lugar llamado «{otro.nombre}».")
    return nombre


@router.post("/lugares")
async def crear_lugar(datos: DatosLugar, usuario: Usuario = Depends(usuario_actual),
                      sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    _puede_escribir(usuario)
    lugar = Lugar(nombre=await _nombre_libre(sesion, datos.nombre), lat=datos.lat, lon=datos.lon,
                  radio_m=lg.radio_valido(datos.radio_m))
    sesion.add(lugar)
    await sesion.commit()
    return _ficha_lugar(lugar)


@router.patch("/lugares/{lugar_id}")
async def cambiar_lugar(lugar_id: int, datos: DatosLugar, usuario: Usuario = Depends(usuario_actual),
                        sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Renombrar, mover o cambiar el radio. Renombrar renombra el lugar de sus fotos."""
    _puede_escribir(usuario)
    lugar = await _lugar(sesion, lugar_id)
    nombre = await _nombre_libre(sesion, datos.nombre, salvo=lugar.id)
    if nombre != lugar.nombre:
        await sesion.execute(update(Foto).where(Foto.lugar_id == lugar.id).values(lugar=nombre))
    lugar.nombre, lugar.lat, lugar.lon, lugar.radio_m = nombre, datos.lat, datos.lon, lg.radio_valido(datos.radio_m)
    await sesion.commit()
    return _ficha_lugar(lugar)


@router.delete("/lugares/{lugar_id}")
async def quitar_lugar(lugar_id: int, usuario: Usuario = Depends(usuario_actual),
                       sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Quita el lugar con nombre; sus fotos conservan las coordenadas y el texto del lugar."""
    _puede_escribir(usuario)
    lugar = await _lugar(sesion, lugar_id)
    await sesion.execute(update(Foto).where(Foto.lugar_id == lugar.id).values(lugar_id=None))
    await sesion.delete(lugar)
    await sesion.commit()
    return {"ok": True}


@router.post("/lugares/{lugar_id}/cercanas")
async def asignar_cercanas(lugar_id: int, aplicar: bool = False, usuario: Usuario = Depends(usuario_actual),
                           sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Las fotos con GPS dentro del radio y sin lugar con nombre: sin `aplicar`, cuántas son; con él, las asigna."""
    _puede_escribir(usuario)
    lugar = await _lugar(sesion, lugar_id)
    ids = await lg.cercanas(sesion, lugar)
    if aplicar and ids:
        await sesion.execute(update(Foto).where(Foto.id.in_(ids)).values(lugar_id=lugar.id, lugar=lugar.nombre))
        await sesion.commit()
    return {"n": len(ids), "aplicado": bool(aplicar)}


# --- Personas y sus caras (2026-10-19; rikchay/caras.py) --------------------------------------


@router.get("/personas")
async def personas(_: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> list[dict]:
    """Las personas con cara marcada: en cuántas fotos y la cara que hace de retrato (la más grande)."""
    filas = (await sesion.execute(text(
        "SELECT p.id, p.nombre, count(DISTINCT c.foto_id) AS n, "
        "(SELECT c2.id FROM media_caras c2 JOIN fototeca_fotos f2 ON f2.id = c2.foto_id "
        " WHERE c2.persona_id = p.id AND f2.eliminada_en IS NULL ORDER BY c2.ancho * c2.alto DESC, c2.id LIMIT 1) AS cara "
        "FROM media_personas p JOIN media_caras c ON c.persona_id = p.id JOIN fototeca_fotos f ON f.id = c.foto_id "
        "WHERE f.eliminada_en IS NULL GROUP BY p.id ORDER BY n DESC, p.nombre"
    ))).all()
    return [{"id": i, "nombre": nombre, "n": n, "cara_id": cara} for i, nombre, n, cara in filas]


@router.get("/caras/detector")
async def detector(_: Usuario = Depends(usuario_actual)) -> dict:
    """Si la detección automática está instalada (es opcional)."""
    return await asyncio.to_thread(cr.detector)


@router.get("/caras/{cara_id}/recorte")
async def recorte_cara(cara_id: int, peticion: Request, lado: int = 256, _: Usuario = Depends(usuario_actual),
                       sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> Response:
    """La cara recortada en cuadrado: el retrato de la persona en esa foto."""
    cara = await sesion.get(Cara, cara_id)
    if cara is None:
        raise HTTPException(404, "Cara no encontrada.")
    foto = await _foto(sesion, cara.foto_id)
    ruta = await _en_hilo(cr.recorte, foto.archivo, foto.sha256, (cara.x, cara.y, cara.ancho, cara.alto), lado)
    persona = await sesion.get(Persona, cara.persona_id) if cara.persona_id else None
    nombre = ft.slug(persona.nombre if persona else "cara") or "cara"
    return enviar_archivo(ruta, f"{nombre}-{foto.id}.jpg", media_type="image/jpeg", peticion=peticion)


class DatosCara(BaseModel):
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    ancho: float | None = Field(default=None, gt=0, le=1)
    alto: float | None = Field(default=None, gt=0, le=1)
    # El nombre de la persona; vacío = cara sin nombre («¿Quién es?»).
    persona: str | None = Field(default=None, max_length=200)
    origen: str = "manual"
    confianza: float | None = Field(default=None, ge=0, le=1)


async def _respuesta_caras(sesion: AsyncSession, foto: Foto) -> dict:
    return {"caras": await cr.caras_de(sesion, foto.id), "personas": foto.personas or []}


async def _poner_persona(sesion: AsyncSession, foto: Foto, cara: Cara, nombre: str | None) -> None:
    """Cambia quién es la cara y mantiene la lista `personas` de la foto al día."""
    nombre = cr.limpiar_nombre(nombre)
    anterior = await sesion.get(Persona, cara.persona_id) if cara.persona_id else None
    nueva = await cr.persona_por_nombre(sesion, nombre) if nombre else None
    if anterior is not None and (nueva is None or nueva.id != anterior.id) \
            and not await cr.quedan_caras(sesion, foto.id, anterior.id, salvo=cara.id):
        foto.personas = cr.nombres_sin(foto.personas, anterior.nombre)
    cara.persona_id = nueva.id if nueva else None
    if nueva is not None:
        foto.personas = cr.nombres_con(foto.personas, nueva.nombre)


@router.patch("/caras/{cara_id}")
async def cambiar_cara(cara_id: int, datos: DatosCara, usuario: Usuario = Depends(usuario_actual),
                       sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Quién es (o mover la región). Solo cambia lo que viaja."""
    _puede_escribir(usuario)
    cara = await sesion.get(Cara, cara_id)
    if cara is None:
        raise HTTPException(404, "Cara no encontrada.")
    foto = await _foto(sesion, cara.foto_id, papelera_ok=False)
    if {"x", "y", "ancho", "alto"} & datos.model_fields_set:
        try:
            cara.x, cara.y, cara.ancho, cara.alto = cr.normalizar_caja(
                datos.x if datos.x is not None else cara.x, datos.y if datos.y is not None else cara.y,
                datos.ancho if datos.ancho is not None else cara.ancho, datos.alto if datos.alto is not None else cara.alto)
        except ValueError as e:
            raise HTTPException(422, str(e))
    if "persona" in datos.model_fields_set:
        await _poner_persona(sesion, foto, cara, datos.persona)
        cara.origen = cara.origen if cara.origen in cr.ORIGENES else "manual"
    await sesion.commit()
    return await _respuesta_caras(sesion, foto)


@router.delete("/caras/{cara_id}")
async def quitar_cara(cara_id: int, usuario: Usuario = Depends(usuario_actual),
                      sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Quita la región; si era la última cara de esa persona en la foto, su nombre sale de la lista."""
    _puede_escribir(usuario)
    cara = await sesion.get(Cara, cara_id)
    if cara is None:
        raise HTTPException(404, "Cara no encontrada.")
    foto = await _foto(sesion, cara.foto_id)
    await _poner_persona(sesion, foto, cara, None)
    await sesion.delete(cara)
    await sesion.commit()
    return await _respuesta_caras(sesion, foto)


# --- Una foto ------------------------------------------------------------------------------


@router.get("/{foto_id}")
async def ver(foto_id: int, _: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    foto = await _foto(sesion, foto_id)
    d = (await _vigentes([ft.ficha(foto, detalle=True)]))[0]
    if foto.subido_por:
        persona = await capacidad("identidad.v1").persona(foto.subido_por)
        d["subido_por_nombre"] = persona["nombre"] if persona else ""
    return d


@router.get("/{foto_id}/original")
async def original(foto_id: int, peticion: Request, _: Usuario = Depends(usuario_actual),
                   sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> Response:
    foto = await _foto(sesion, foto_id)
    ruta = ft.ruta_original(foto.archivo)
    if not ruta.is_file():
        raise HTTPException(404, "El original no está en la Fototeca.")
    ext = ruta.suffix.lstrip(".").lower()
    return enviar_archivo(ruta, foto.nombre_original or ruta.name, media_type=MEDIA.get(ext, "application/octet-stream"),
                          peticion=peticion, rangos=foto.medio == "video")


@router.get("/{foto_id}/enlace-video")
async def enlace_video(foto_id: int, _: Usuario = Depends(usuario_actual),
                       sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Dirección firmada (vida corta) para reproducir un video en un <video>."""
    foto = await _foto(sesion, foto_id)
    if foto.medio != "video":
        raise HTTPException(422, "No es un video.")
    return {"url": f"/api/fototeca/{foto.id}/video?firma={firmar_video(foto.id)}", "horas": HORAS_ENLACE}


@router.get("/{foto_id}/video")
async def video(foto_id: int, peticion: Request, firma: str = "",
                sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> Response:
    """El video para el reproductor: sin token (no lo manda un <video>), con el enlace
    firmado de `enlace-video`, y con Range para adelantar."""
    if leer_firma_video(firma) != foto_id:
        raise HTTPException(401, "Enlace del video vencido o no válido: vuelva a abrirlo desde la Fototeca.")
    foto = await _foto(sesion, foto_id)
    ruta = ft.ruta_original(foto.archivo)
    if foto.medio != "video" or not ruta.is_file():
        raise HTTPException(404, "El video no está en la Fototeca.")
    return enviar_archivo(ruta, foto.nombre_original or ruta.name,
                          media_type=ft.MEDIA_VIDEO.get(ruta.suffix.lower(), "video/mp4"), peticion=peticion, rangos=True)


async def _derivado(sesion: AsyncSession, foto_id: int, tipo: str, peticion: Request) -> Response:
    foto = await _foto(sesion, foto_id)
    ruta = await _en_hilo(ft.derivado, foto.archivo, foto.sha256, foto.ajustes, tipo)
    return enviar_archivo(ruta, f"{tipo}-{foto.id}.jpg", media_type="image/jpeg", peticion=peticion)


@router.get("/{foto_id}/miniatura")
async def miniatura(foto_id: int, peticion: Request, _: Usuario = Depends(usuario_actual),
                    sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> Response:
    """400 px con los ajustes. La web pide `?v=<version>`: un ajuste nuevo es otra dirección."""
    return await _derivado(sesion, foto_id, "miniatura", peticion)


@router.get("/{foto_id}/vista")
async def vista(foto_id: int, peticion: Request, crudo: bool = False, _: Usuario = Depends(usuario_actual),
                sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> Response:
    """1600 px con los ajustes; `crudo=1`, sin ellos (la base del editor)."""
    return await _derivado(sesion, foto_id, "crudo" if crudo else "vista", peticion)


@router.get("/{foto_id}/exportar")
async def exportar(foto_id: int, peticion: Request, preset: str = "original", formato: str = "jpg",
                   _: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> Response:
    foto = await _foto(sesion, foto_id)
    ruta = await _en_hilo(ft.exportar, foto.archivo, foto.sha256, foto.ajustes, preset, formato)
    return enviar_archivo(ruta, ft.nombre_exportado(foto.nombre_original, foto.titulo, preset, formato),
                          media_type=MEDIA.get(formato, "image/jpeg"), peticion=peticion)


@router.get("/{foto_id}/sugerir-ajustes")
async def sugerir(foto_id: int, _: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Mejora automática propuesta (luz y contraste); no se guarda hasta aceptarla."""
    foto = await _foto(sesion, foto_id)
    return await _en_hilo(ft.sugerir_ajustes, foto.archivo, foto.sha256)


class Cambio(BaseModel):
    titulo: str | None = Field(default=None, max_length=300)
    descripcion: str | None = None
    lugar: str | None = Field(default=None, max_length=200)
    etiquetas: list[str] | None = None
    personas: list[str] | None = None
    estado: str | None = None
    favorita: bool | None = None
    calificacion: int | None = Field(default=None, ge=0, le=5)
    album_id: int | None = None
    ajustes: dict | None = None
    seleccion: str | None = None
    color: str | None = None
    # Presente (aunque sea null) = poner en ese lugar con nombre (su nombre pasa a `lugar`) o sacar de él.
    lugar_id: int | None = None
    # Corregir la fecha cuando la cámara no la tenía (AAAA-MM-DDTHH:MM).
    tomada_en: str | None = None


@router.patch("/{foto_id}")
async def cambiar(
    foto_id: int,
    datos: Cambio,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Solo cambia lo que viaja (a diferencia del PUT de los documentos)."""
    _puede_escribir(usuario)
    foto = await _foto(sesion, foto_id)
    enviados = datos.model_fields_set
    for clave in ("titulo", "descripcion", "lugar"):
        if clave in enviados and getattr(datos, clave) is not None:
            setattr(foto, clave, getattr(datos, clave).strip())
    if "lugar" in enviados and datos.lugar is not None and "lugar_id" not in enviados:
        foto.lugar_id = None  # otro lugar escrito a mano: deja el lugar con nombre
    if "lugar_id" in enviados:
        lugar = await _lugar(sesion, datos.lugar_id) if datos.lugar_id else None
        foto.lugar_id = lugar.id if lugar else None
        if lugar:
            foto.lugar = lugar.nombre
    if datos.etiquetas is not None:
        foto.etiquetas = ft.normalizar_lista(datos.etiquetas)
    if datos.personas is not None:
        foto.personas = ft.normalizar_lista(datos.personas)
        await cr.soltar_caras_sin_nombre(sesion, foto)
    if datos.estado is not None:
        if datos.estado not in ft.ESTADOS:
            raise HTTPException(422, "Estado desconocido.")
        foto.estado = datos.estado
    if datos.favorita is not None:
        foto.favorita = datos.favorita
    if datos.calificacion is not None:
        foto.calificacion = datos.calificacion
    _depuracion(datos.seleccion, datos.color)
    if datos.seleccion is not None:
        foto.seleccion = datos.seleccion
    if datos.color is not None:
        foto.color = datos.color
    if "album_id" in enviados:
        if datos.album_id is not None and await sesion.get(AlbumFoto, datos.album_id) is None:
            raise HTTPException(404, "Álbum no encontrado.")
        foto.album_id = datos.album_id
    if datos.ajustes is not None:
        if foto.medio == "video" and ft.normalizar_ajustes(datos.ajustes):
            raise HTTPException(422, "Los videos no se editan en la Fototeca (se editan en Prensa).")
        foto.ajustes = ft.normalizar_ajustes(datos.ajustes)
    if datos.tomada_en:
        try:
            nueva = datetime.fromisoformat(datos.tomada_en)
        except ValueError:
            raise HTTPException(422, "Fecha inválida.")
        foto.tomada_en = nueva if nueva.tzinfo else nueva.replace(tzinfo=ft.zona())
    await sesion.commit()
    await sesion.refresh(foto)
    return (await _vigentes([ft.ficha(foto, detalle=True)]))[0]


@router.delete("/{foto_id}")
async def a_papelera(foto_id: int, usuario: Usuario = Depends(usuario_actual),
                     sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """A la papelera (se restaura cuando se quiera). El original no se borra."""
    _puede_escribir(usuario)
    foto = await _foto(sesion, foto_id)
    foto.eliminada_en = datetime.now().astimezone()
    await sesion.commit()
    return {"ok": True}


@router.post("/{foto_id}/restaurar")
async def restaurar(foto_id: int, usuario: Usuario = Depends(usuario_actual),
                    sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    _puede_escribir(usuario)
    foto = await _foto(sesion, foto_id)
    foto.eliminada_en = None
    await sesion.commit()
    return {"ok": True}


class Vinculo(BaseModel):
    tipo: str
    id: int
    codigo: str | None = None


async def etiqueta_vinculo(tipo: str, ident: int) -> str:
    """Cómo se nombra el destino de un vínculo (SR-02, PL-0003, OF-0100): se le pregunta a su dueño por
    referencia (fase 10.2b); si el dueño no está o el destino no existe, queda sin nombre."""
    modulo = {"semana": "representacion", "proyecto": "proyectos", "documento": "documentos"}.get(tipo)
    r = await resolver(f"{modulo}:{tipo}:{ident}") if modulo else None
    return r["titulo"] if r else ""


@router.post("/{foto_id}/vincular")
async def vincular(
    foto_id: int,
    datos: Vinculo,
    usuario: Usuario = Depends(usuario_actual),
    sesion: AsyncSession = Depends(obtener_sesion_mediateca),
) -> dict:
    """Anota dónde se usó la foto (un proyecto, un documento, una semana)."""
    _puede_escribir(usuario)
    if datos.tipo not in ft.TIPOS_VINCULO:
        raise HTTPException(422, "Tipo de vínculo desconocido.")
    foto = await _foto(sesion, foto_id)
    etiqueta = await etiqueta_vinculo(datos.tipo, datos.id)
    if not etiqueta:
        raise HTTPException(404, "No existe aquello con lo que se quiere vincular.")
    foto.vinculos = ft.con_vinculo(foto.vinculos, {"tipo": datos.tipo, "id": datos.id, "codigo": datos.codigo,
                                                   "etiqueta": etiqueta})
    await sesion.commit()
    return {"vinculos": foto.vinculos}


@router.get("/{foto_id}/caras")
async def caras_de_foto(foto_id: int, _: Usuario = Depends(usuario_actual),
                        sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    foto = await _foto(sesion, foto_id)
    return await _respuesta_caras(sesion, foto)


@router.post("/{foto_id}/caras")
async def marcar_cara(foto_id: int, datos: DatosCara, usuario: Usuario = Depends(usuario_actual),
                      sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Una cara nueva, marcada a mano o confirmada de una propuesta del detector (`origen = modelo`)."""
    _puede_escribir(usuario)
    foto = await _foto(sesion, foto_id, papelera_ok=False)
    if foto.medio != "foto":
        raise HTTPException(422, "Las caras se marcan en fotos.")
    if None in (datos.x, datos.y, datos.ancho, datos.alto):
        raise HTTPException(422, "Falta la región de la cara.")
    try:
        x, y, w, h = cr.normalizar_caja(datos.x, datos.y, datos.ancho, datos.alto)
    except ValueError as e:
        raise HTTPException(422, str(e))
    cara = Cara(foto_id=foto.id, x=x, y=y, ancho=w, alto=h, origen=datos.origen if datos.origen in cr.ORIGENES else "manual",
                confianza=datos.confianza if datos.origen == "modelo" else None)
    sesion.add(cara)
    await sesion.flush()
    await _poner_persona(sesion, foto, cara, datos.persona)
    await sesion.commit()
    return await _respuesta_caras(sesion, foto)


@router.post("/{foto_id}/detectar-caras")
async def detectar_caras(foto_id: int, usuario: Usuario = Depends(usuario_actual),
                         sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Propone caras (no guarda nada): cada una se confirma poniéndole nombre (`POST /{id}/caras`)."""
    _puede_escribir(usuario)
    foto = await _foto(sesion, foto_id, papelera_ok=False)
    if foto.medio != "foto":
        raise HTTPException(422, "Las caras se detectan en fotos.")
    cruda = await _en_hilo(ft.derivado, foto.archivo, foto.sha256, {}, "crudo")
    try:
        propuestas = await asyncio.to_thread(cr.detectar, cruda)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    existentes = [(c["x"], c["y"], c["ancho"], c["alto"]) for c in await cr.caras_de(sesion, foto.id)]
    return {"propuestas": cr.propuestas_nuevas(propuestas, existentes)}


@router.get("/{foto_id}/versiones")
async def versiones(foto_id: int, _: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_mediateca)) -> dict:
    """Las versiones editadas de un original (la más nueva primero), o, si la foto ES una versión, su original y
    sus hermanas. Cada versión dice de qué tipo es, cuándo se hizo y con qué ajustes."""
    foto = await _foto(sesion, foto_id)
    propia = (await sesion.execute(select(Version).where(Version.derivada_id == foto.id))).scalars().first()
    original = await sesion.get(Foto, propia.original_id) if propia else foto
    filas = (await sesion.execute(
        select(Version, Foto).join(Foto, Foto.id == Version.derivada_id)
        .where(Version.original_id == original.id).order_by(Version.creado_en.desc(), Version.id.desc())
    )).all()
    lista = []
    for v, f in filas:
        d = ft.ficha(f)
        d["version_de"] = {"tipo": v.tipo, "ajustes": ft.normalizar_ajustes(v.ajustes),
                           "creado_en": v.creado_en.isoformat() if v.creado_en else None}
        lista.append(d)
    return {"original": (await _vigentes([ft.ficha(original)]))[0] if original is not None else None,
            "es_version": propia is not None, "versiones": await _vigentes(lista)}
