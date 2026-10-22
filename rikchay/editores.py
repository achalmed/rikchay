"""rikchay/editores.py — lo que la Mediateca ofrece a los editores del estudio por «medios.v1» y «medios.v2»
(editores E2b, fase 10.2b, 2026-10-20).

Antes el proxy de Prensa leía y escribía las tablas de la Mediateca con su sesión. Ahora pide operaciones, y cada una
abre su propia sesión de la base de la Mediateca y hace su commit:

- `fotos_para_editor(album, limite)`: las fotos que el selector de un editor ofrece (públicas y las de un álbum);
- `foto_vigente(foto_id)`: lo que hace falta para darle a un editor una foto (su archivo, su huella y sus ajustes);
- `pieza_vigente(archivo, ambito)`: una pieza ya guardada, por su ruta en la Mediateca, para descargarla;
- `ingresar(ruta, nombre, usuario_id, …)`: lo que un editor exporta o recibe entra a la Mediateca, una sola vez por
  huella. Una PIEZA entra con nombre por la fecha y los metadatos que dé quien llama (`metadatos(medio, ancho, alto)`),
  con sus usos y, si sale de otra foto, como versión de ella; una SUBIDA es una foto más, con sus etiquetas.

Nada de esto sabe de Prensa: el ámbito, las etiquetas y los usos los pone el editor (servicios/estudio_mediateca.py de Qillqa).

Y, desde «medios.v2» (2026-10-21), lo que piden la Semana y el ingreso de documentos, también con su propia sesión:

- `registrar_archivo(ruta, nombre, usuario_id, mover, vinculo, datos)`: una foto (o la que ya estaba, por su huella),
  con su vínculo y sus datos (los vacíos se llenan; lo corregido no se pisa). → (ficha, nueva); ErrorFototeca si no;
- `fotos_vigentes(ids, medio)`: las fichas de esas fotos, en orden de toma;
- `llevar_a(foto_id, vinculo, usuario_id)`: la foto queda vinculada y, si tiene ajustes, su versión editada (un registro
  propio, versión del original) es la que se cita. → {ficha, ruta del archivo que se cita} o None;
- `vincular(foto_id, vinculo)`: suma un vínculo. → la ficha o None;
- `huella_de_archivo(archivo)`: la huella registrada de un archivo de la Mediateca, o None;
- `album(nombre, descripcion, usuario_id)`: el id del álbum con ese nombre (se crea si falta).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Callable

from sqlalchemy import or_, select

from rikchay import modelos as mm
from rikchay import fototeca as ft
from rikchay.db import SesionMediateca

log = logging.getLogger("qillqa.fototeca")


def _ficha(f: mm.Foto, album: str = "") -> dict:
    return {"id": f.id, "titulo": f.titulo or "", "nombre_original": f.nombre_original or "", "album": album,
            "archivo": f.archivo, "sha256": f.sha256, "ajustes": f.ajustes or {}, "medio": f.medio,
            "version": ft.clave_ajustes(f.ajustes), "estado": f.estado, "descripcion": f.descripcion or ""}


async def fotos_para_editor(album: str = "", limite: int = 300) -> list[dict]:
    """Las fotos (no videos) públicas o del álbum `album` (sin distinguir mayúsculas), las más recientes primero."""
    async with SesionMediateca() as sesion:
        albumes = {a.id: a.nombre for a in (await sesion.execute(select(mm.AlbumFoto))).scalars().all()}
        del_album = [i for i, n in albumes.items() if album and n.strip().lower() == album.strip().lower()]
        cond = mm.Foto.estado == "publica"
        if del_album:
            cond = or_(cond, mm.Foto.album_id.in_(del_album))
        fotos = (await sesion.execute(
            select(mm.Foto).where(mm.Foto.eliminada_en.is_(None), mm.Foto.medio == "foto", cond)
            .order_by(mm.Foto.tomada_en.desc(), mm.Foto.id.desc()).limit(limite))).scalars().all()
        return [_ficha(f, albumes.get(f.album_id, "")) for f in fotos]


async def foto_vigente(foto_id: int) -> dict | None:
    """La foto (o el video) si existe y no está en la papelera; None si no."""
    async with SesionMediateca() as sesion:
        f = await sesion.get(mm.Foto, int(foto_id))
        return _ficha(f) if f is not None and f.eliminada_en is None else None


async def pieza_vigente(archivo: str, ambito: str) -> dict | None:
    """La pieza de ese ámbito guardada en `archivo` (ruta relativa a la Mediateca), si sigue vigente."""
    async with SesionMediateca() as sesion:
        f = (await sesion.execute(select(mm.Foto).where(
            mm.Foto.archivo == archivo, mm.Foto.ambito == ambito, mm.Foto.eliminada_en.is_(None)))).scalars().first()
        return _ficha(f) if f is not None else None


async def _vincular(sesion, foto: mm.Foto, usos: list[str], tipo_uso: str, origen: int | None, tipo_version: str) -> None:
    """La foto y la de origen con sus usos y, si sale de otra foto, como versión de ella. Idempotente."""
    origen = origen if origen and origen != foto.id and await sesion.get(mm.Foto, origen) is not None else None
    for fid in [foto.id] + ([origen] if origen else []):
        for ref in usos:
            if (await sesion.execute(select(mm.Uso.id).where(mm.Uso.foto_id == fid, mm.Uso.tipo == tipo_uso,
                                                          mm.Uso.referencia == ref))).first() is None:
                sesion.add(mm.Uso(foto_id=fid, tipo=tipo_uso, referencia=ref))
    if origen and tipo_version and (await sesion.execute(select(mm.Version.id).where(
            mm.Version.original_id == origen, mm.Version.derivada_id == foto.id))).first() is None:
        sesion.add(mm.Version(original_id=origen, derivada_id=foto.id, tipo=tipo_version, ajustes={}))
    await sesion.flush()


async def ingresar(ruta: Path, nombre: str, usuario_id: int | None, *,
                   metadatos: Callable[[str, int, int], dict] | None = None, etiquetas: list[str] | None = None,
                   titulo: str = "", usos: list[str] | None = None, tipo_uso: str = "", origen: int | None = None,
                   tipo_version: str = "") -> dict | None:
    """Registra un archivo que está en la carpeta temporal de la Mediateca (se mueve o se borra).

    Con `metadatos` es una PIEZA: entra con nombre por la fecha (AAAAMMDD_HHMMSS) y los metadatos que devuelve
    `metadatos(medio, ancho, alto)`, y lleva sus `usos` y su versión de `origen`. Sin él, una SUBIDA: una foto más,
    con sus `etiquetas` y su `titulo`. Si ya estaba (misma huella), no se le cambia nada. → {id, nueva, archivo} o
    None (se avisa en el registro)."""
    async with SesionMediateca() as sesion:
        try:
            sha, _ = await asyncio.to_thread(ft.huella, ruta)
            foto = (await sesion.execute(select(mm.Foto).where(mm.Foto.sha256 == sha))).scalar_one_or_none()
            nueva = False
            if foto is not None:
                ruta.unlink(missing_ok=True)
            elif metadatos is not None:
                ahora = datetime.now().astimezone()
                foto, nueva = await ft.registrar(sesion, ruta, f"{ahora:%Y%m%d_%H%M%S}{ruta.suffix}", usuario_id, mover=True)
                if nueva:
                    meta = metadatos(foto.medio, foto.ancho, foto.alto)
                    meta["etiquetas"] = ft.normalizar_lista(meta.get("etiquetas") or [])
                    for clave, valor in meta.items():
                        setattr(foto, clave, valor)
                    foto.nombre_original = foto.archivo.rsplit("/", 1)[-1]
            else:
                foto, nueva = await ft.registrar(sesion, ruta, nombre, usuario_id, mover=True,
                                                 datos={"etiquetas": list(etiquetas or []), "titulo": titulo})
            if metadatos is not None:
                await _vincular(sesion, foto, list(usos or []), tipo_uso, origen, tipo_version)
            await sesion.commit()
            return {"id": foto.id, "nueva": nueva, "archivo": foto.archivo}
        except Exception as e:  # noqa: BLE001 — aquí solo se avisa; quien llama decide si es un error
            await sesion.rollback()
            ruta.unlink(missing_ok=True)
            log.warning("No se pudo registrar en la Mediateca lo que vino de un editor (%s): %s", nombre, e)
            return None


# --- «medios.v2»: lo que piden la Semana y el ingreso (2026-10-21) ---------------------------------------------------


async def registrar_archivo(ruta: Path, nombre: str, usuario_id: int | None, *, mover: bool = False,
                            vinculo: dict | None = None, datos: dict | None = None) -> tuple[dict, bool]:
    async with SesionMediateca() as sesion:
        foto, nueva = await ft.registrar(sesion, ruta, nombre, usuario_id, mover=mover, vinculo=vinculo, datos=datos)
        await sesion.commit()
        return _ficha(foto), nueva


async def fotos_vigentes(ids, medio: str | None = "foto") -> list[dict]:
    ids = [int(i) for i in ids or () if i]
    if not ids:
        return []
    async with SesionMediateca() as sesion:
        q = select(mm.Foto).where(mm.Foto.id.in_(ids), mm.Foto.eliminada_en.is_(None))
        if medio:
            q = q.where(mm.Foto.medio == medio)
        return [_ficha(f) for f in (await sesion.execute(q.order_by(mm.Foto.tomada_en))).scalars().all()]


async def llevar_a(foto_id: int, vinculo: dict, usuario_id: int | None) -> dict | None:
    async with SesionMediateca() as sesion:
        foto = await sesion.get(mm.Foto, int(foto_id))
        if foto is None or foto.eliminada_en is not None:
            return None
        foto.vinculos = ft.con_vinculo(foto.vinculos, vinculo)
        archivo = foto.archivo
        if ft.normalizar_ajustes(foto.ajustes):
            archivo = (await ft.version_editada(sesion, foto, usuario_id)).archivo
        await sesion.commit()
        return {"ficha": _ficha(foto), "ruta": ft.ruta_original(archivo)}


async def vincular(foto_id: int, vinculo: dict) -> dict | None:
    async with SesionMediateca() as sesion:
        foto = await sesion.get(mm.Foto, int(foto_id))
        if foto is None:
            return None
        foto.vinculos = ft.con_vinculo(foto.vinculos, vinculo)
        await sesion.commit()
        return _ficha(foto)


async def huella_de_archivo(archivo: str) -> str | None:
    async with SesionMediateca() as sesion:
        return (await sesion.execute(select(mm.Foto.sha256).where(mm.Foto.archivo == archivo))).scalar_one_or_none()


async def album(nombre: str, descripcion: str, usuario_id: int | None) -> int:
    async with SesionMediateca() as sesion:
        existente = (await sesion.execute(select(mm.AlbumFoto).where(mm.AlbumFoto.nombre == nombre))).scalars().first()
        if existente:
            return existente.id
        a = mm.AlbumFoto(nombre=nombre, descripcion=descripcion, creado_por=usuario_id)
        sesion.add(a)
        await sesion.commit()
        return a.id
