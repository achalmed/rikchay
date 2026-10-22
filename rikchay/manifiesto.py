"""El manifiesto de la Mediateca: el MISMO dentro de Qillqa (app/plataforma.py) y sola (rikchay/sola.py,
con el anfitrión mínimo de Tiqsi). Fase 10.2b de docs/plataforma/propuesta-repositorios.md de Qillqa, 2026-10-20.

Necesita solo la identidad (la da cualquier anfitrión). Aprovecha la Semana de representación («semanas.v1») y
las etiquetas de lo vinculado («etiquetas.v1»): sin ellas, esas partes no se ofrecen o muestran lo guardado.
"""
from __future__ import annotations

from tiqsi import Manifiesto
from tiqsi.bandeja_sql import BandejaSQL

from rikchay import api as fototeca
from rikchay.modelos import BANDEJA
from rikchay import contrato as fototeca_contrato
from rikchay import db as fototeca_db

VERSION = "0.1.0"


async def _preparar_base(_anfitrion) -> None:
    """Su base y sus tablas, si faltan (idempotente)."""
    await fototeca_db.crear_base_si_falta()
    await fototeca_db.crear_tablas()


MANIFIESTO = Manifiesto(
    id="fototeca", nombre="Mediateca", version=VERSION, contrato="^0.1",
    routers=[fototeca.router], prefijos=("/api/fototeca",),
    ofrece={"medios.v1": fototeca_contrato.V1, "medios.v2": fototeca_contrato.V2},
    resolutores={"foto": fototeca_contrato.resolver_foto},
    necesita=("identidad.v1",), aprovecha=("semanas.v1", "etiquetas.v1"),
    al_arrancar=[_preparar_base],
    # Lo que la Mediateca cuenta («fototeca.foto.subida»), guardado con el cambio y repartido por el anfitrión.
    bandeja=BandejaSQL(fototeca_db.SesionMediateca, BANDEJA),
)
