---
tipo: changelog
estado: activo
---
# CHANGELOG — rikchay

## [Unreleased]

### Añadido

- **Su demo pública** (2026-10-21): la receta en `demo/` y `scripts/exportar_demo.py` sobre `tiqsi.demo`; el escáner
  limpio y sus pruebas pasan sobre el árbol de la demo. Sin aplicar ni publicar (con el visto bueno de Edison).
- **Rikchay nace** (2026-10-21, fase 10.3 de Qillqa): la Mediateca sale de Qillqa (commit `8690dee`) con su backend
  (`rikchay/`), sus pruebas, su paquete web `@qillqa/rikchay` y su página sola; las importaciones pasan de
  `app.servicios.fototeca_*` a `rikchay.*`, y su prueba de fronteras exige que no importe nada de Qillqa.
