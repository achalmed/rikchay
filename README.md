# Rikchay — una mediateca para instituciones

Rikchay («imagen, semejanza» en quechua) es una **mediateca**: las fotos, los videos y los documentos de marca de
una institución en un solo lugar, con su selección (aceptada, pendiente, rechazada), personas y caras, lugares en el
mapa, etiquetas, versiones no destructivas, fotos parecidas y dónde se usó cada una.

**Recorrido interactivo:** <https://achalmed.github.io/rikchay/> (el código del sitio está en [`sitio/`](sitio/)).

Es un módulo de [Tiqsi](https://github.com/achalmed/tiqsi): funciona **solo**, con el anfitrión mínimo de Tiqsi y
sus propias cuentas, o dentro de una plataforma que lo monte por su manifiesto (como Qillqa).

## Probarlo

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -e '.[pruebas,sola]'   # requiere tiqsi
.venv/bin/python -m pytest -q tests
npm install && npm run web:construir
MEDIATECA_DATABASE_URL=postgresql+asyncpg://usuario:clave@127.0.0.1:5432/rikchay MEDIATECA_DIR=/ruta/mediateca \
  JWT_SECRET=<32 o más caracteres> MEDIATECA_WEB=web/dist .venv/bin/uvicorn rikchay.sola:app --port 8030
```

Las cuentas se crean con `python -m tiqsi.minimo cuenta <MEDIATECA_DIR>/cuentas.json <usuario> --rol administrador`.

Esta es una **versión de demostración**, sin datos reales. Licencia: AGPL-3.0 (`LICENSE`).
