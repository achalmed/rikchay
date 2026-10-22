"""Lo que la Mediateca ofrece a los demás módulos: la capacidad «medios.v1» y el resolutor de «foto»
(fase 10.2b de docs/plataforma/propuesta-repositorios.md de Qillqa, 2026-10-20).

Nadie fuera de la Mediateca importa `rikchay/fototeca.py` ni `rikchay/modelos.py`: piden «medios.v1» al
anfitrión (`tiqsi.modulo.Perezosa("medios.v1")`) y usan SOLO lo que esta lista declara. Es la superficie del
contrato: la Mediateca puede cambiar por dentro sin romper a nadie mientras esto no cambie.

Versión 1, con una concesión: incluye sus MODELOS, porque Prensa, la Semana y el ingreso de documentos consultaban
sus tablas directamente. Desde el 2026-10-21 esas consultas son operaciones de la Mediateca y todos usan «medios.v2»,
sin modelos (abajo); la v1 sigue ofrecida, sin uso, hasta extraer la Mediateca (Rikchay, 10.3).
"""
from __future__ import annotations

from rikchay import modelos as mm
from rikchay import fototeca as ft
from rikchay import editores as fe

FUNCIONES = (
    # registrar y leer originales
    "registrar", "huella", "admitido", "es_video", "ruta_original", "raiz", "carpeta_temporal",
    "MAX_FOTO", "MAX_VIDEO", "ErrorFototeca",
    # derivados, ajustes y exportación
    "derivado", "exportar", "PRESETS", "clave_ajustes", "normalizar_ajustes", "version_editada",
    # metadatos y vínculos
    "normalizar_lista", "con_vinculo", "estado_desde_semana", "estado_hacia_semana",
)
# Las operaciones para los editores del estudio (editores E2b, 2026-10-20; rikchay/editores.py): cada una con
# su propia sesión. Con ellas, Prensa y los editores ya no tocan las tablas de la Mediateca.
EDITORES = ("fotos_para_editor", "foto_vigente", "pieza_vigente", "ingresar")
MODELOS = ("Foto", "AlbumFoto", "Uso", "Version")

class _MediosV1:
    """La superficie de «medios.v1»: resuelve cada nombre al usarlo (lo que se cambie en `rikchay/fototeca.py`,
    también en pruebas, se ve) y rechaza lo que no está en la lista: el contrato se cumple, no solo se documenta."""

    def __getattr__(self, nombre: str):
        if nombre in FUNCIONES:
            return getattr(ft, nombre)
        if nombre in EDITORES:
            return getattr(fe, nombre)
        if nombre in MODELOS:
            return getattr(mm, nombre)
        raise AttributeError(f"«{nombre}» no es parte de «medios.v1» (rikchay/contrato.py)")

    def __dir__(self):
        return sorted((*FUNCIONES, *EDITORES, *MODELOS))


V1 = _MediosV1()

# «medios.v2» (2026-10-21): sin MODELOS ni las funciones que reciben una sesión de su base (registrar, version_editada,
# con_vinculo): quien la usa pide operaciones, y la Mediateca abre su sesión. La v1 queda ofrecida para quien aún no se
# pasó (nadie, desde hoy: tests/test_fronteras.py lo vigila) y se retira al extraerla (10.3).
FUNCIONES_V2 = tuple(f for f in FUNCIONES if f not in ("registrar", "version_editada", "con_vinculo")) + (
    "registrar_archivo", "fotos_vigentes", "llevar_a", "vincular", "huella_de_archivo", "album")


class _MediosV2:
    """La superficie de «medios.v2»: lo de la v1 que no toca sus tablas, sus operaciones para los editores y las de la
    Semana y el ingreso. Rechaza lo no declarado (los modelos, entre ello)."""

    def __getattr__(self, nombre: str):
        if nombre in EDITORES or nombre in ("registrar_archivo", "fotos_vigentes", "llevar_a", "vincular",
                                            "huella_de_archivo", "album"):
            return getattr(fe, nombre)
        if nombre in FUNCIONES_V2:
            return getattr(ft, nombre)
        raise AttributeError(f"«{nombre}» no es parte de «medios.v2» (rikchay/contrato.py)")

    def __dir__(self):
        return sorted((*FUNCIONES_V2, *EDITORES))


V2 = _MediosV2()


async def resolver_foto(ident: str) -> dict | None:
    """«fototeca:foto:<id>» → {titulo, estado}: el rótulo con que otro módulo muestra una foto vinculada."""
    from sqlalchemy import select

    from rikchay.db import SesionMediateca

    if not ident.isdigit():
        return None
    async with SesionMediateca() as sesion:
        f = (await sesion.execute(select(mm.Foto).where(mm.Foto.id == int(ident)))).scalar_one_or_none()
    if f is None:
        return None
    return {"titulo": f.titulo or f.nombre_original or f"Foto {f.id}", "estado": f.estado,
            "en_papelera": f.eliminada_en is not None}
