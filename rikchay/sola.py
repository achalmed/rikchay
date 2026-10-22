"""La Mediateca SOLA: sin Qillqa y sin la base documental, con el anfitrión mínimo de Tiqsi (Rikchay).

    MEDIATECA_DATABASE_URL=postgresql+asyncpg://…/rikchay  MEDIATECA_DIR=…  JWT_SECRET=<32 o más caracteres> \\
      .venv/bin/uvicorn rikchay.sola:app --port 8030

Su página la da MEDIATECA_WEB (la carpeta construida con `npx vite build` en `web/`).
Las cuentas viven en MEDIATECA_CUENTAS (por omisión <MEDIATECA_DIR>/cuentas.json) y se crean con
`python -m tiqsi.minimo cuenta <archivo> <usuario> --rol administrador`. Sin la Semana de representación ni las
etiquetas de Qillqa, esas partes no se ofrecen: la Mediateca funciona completa con lo suyo.
"""
from __future__ import annotations

import os

from tiqsi.minimo import crear_app

from rikchay.config import config, raiz
from rikchay.manifiesto import MANIFIESTO

app = crear_app([MANIFIESTO], nombre="Mediateca", secreto=config.jwt_secret,
                cuentas=os.environ.get("MEDIATECA_CUENTAS") or raiz() / "cuentas.json",
                # Su página: la cáscara mínima de Tiqsi web con la Mediateca (web/vite.config.ts).
                web=os.environ.get("MEDIATECA_WEB") or None)
