"""La configuración PROPIA de la Mediateca (Rikchay; nació en Qillqa el 2026-10-20, fase 10.2b, y salió a su
repositorio el 2026-10-21).

Lee las mismas variables de entorno que Qillqa (MEDIATECA_DIR, PICTURES_DIR, MEDIATECA_DATABASE_URL,
DATABASE_URL, JWT_SECRET, ZONA_HORARIA, CARAS_PYTHON, CARAS_MODELO), sin depender de Qillqa. Qillqa conserva
`raiz_fototeca()` y `url_mediateca()` en su configuración para sus guiones de migración, y su prueba de fronteras
comprueba que las dos digan lo mismo.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings


class ConfigMediateca(BaseSettings):
    # La base de la Mediateca: MEDIATECA_DATABASE_URL o, si falta, la de DATABASE_URL con otra base
    # («mediateca» si la documental se llama «qillqa»; si no, «<base>_mediateca»).
    database_url: str = ""
    mediateca_database_url: str = ""
    # La carpeta: MEDIATECA_DIR o <PICTURES_DIR>/mediateca (fuera de todo repo; core/env.sh la declara).
    mediateca_dir: str = ""
    pictures_dir: str = ""
    # Firma de los enlaces de video (audiencia propia, vida corta).
    jwt_secret: str = "cambiar-en-produccion"
    zona_horaria: str = "America/Lima"
    # Detección local de caras (opcional): intérprete con OpenCV y modelo (YuNet .onnx o cascada .xml).
    caras_python: str = "python3"
    caras_modelo: str = ""


config = ConfigMediateca()


def raiz() -> Path:
    """La carpeta de la Mediateca."""
    if config.mediateca_dir:
        return Path(config.mediateca_dir).expanduser()
    return (Path(config.pictures_dir).expanduser() if config.pictures_dir else Path.home() / "Pictures") / "mediateca"


def url_base() -> str:
    """La URL de la base de la Mediateca."""
    if config.mediateca_database_url:
        return config.mediateca_database_url
    base, _, nombre = config.database_url.rpartition("/")
    nombre, signo, parametros = nombre.partition("?")
    # La documental de producción se llama aún «sgdp» hasta que el corte la renombre: su Mediateca es «mediateca».
    nueva = "mediateca" if nombre in ("qillqa", "sgdp") else f"{nombre}_mediateca"
    return f"{base}/{nueva}{signo}{parametros}"
