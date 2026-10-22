"""La base PROPIA de la Mediateca: su motor, su sesión y sus tablas (fase 10.2b, 2026-10-20).

Antes vivía en `app/db.py`; ahora es de la Mediateca y viaja con ella. Crear la base si falta (un `CREATE
DATABASE` desde otra conexión del mismo servidor) es tarea del anfitrión: `app/db.py::preparar_mediateca`.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from rikchay.config import url_base

motor = create_async_engine(url_base(), pool_pre_ping=True)
SesionMediateca = async_sessionmaker(motor, expire_on_commit=False)


async def obtener_sesion_mediateca() -> AsyncGenerator[AsyncSession, None]:
    """Dependencia de FastAPI: una sesión de la base de la Mediateca, siempre cerrada."""
    async with SesionMediateca() as sesion:
        yield sesion


async def crear_tablas() -> None:
    """Sus tablas y sus índices (idempotente). La base ya debe existir."""
    from rikchay.modelos import INDICES, BaseMediateca

    async with motor.begin() as conexion:
        await conexion.run_sync(BaseMediateca.metadata.create_all)
        for sql in INDICES:
            await conexion.execute(text(sql))


async def crear_base_si_falta() -> None:
    """Crea la base de la Mediateca si no existe (tiqsi.sql: desde la base «postgres» del mismo servidor). Idempotente.
    La usa el arranque, en Qillqa y sola."""
    from tiqsi.sql import crear_base_si_falta as crear

    await crear(motor.url)
