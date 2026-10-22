"""tests/test_mediateca_sola.py — la Mediateca arranca SOLA, con el anfitrión mínimo de Tiqsi, sin Qillqa ni la base
documental (rikchay/sola.py). Sin base de datos: lo que necesita la base se prueba en vivo contra una vacía (el
`verde.sh sola` de Qillqa).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SECRETO = "m" * 40


def _entorno_limpio(tmp_path) -> dict:
    """Solo lo que la Mediateca necesita: ni DATABASE_URL de Qillqa ni nada del despacho."""
    return {"HOME": os.environ.get("HOME", "/tmp"), "PATH": os.environ.get("PATH", ""),
            "MEDIATECA_DATABASE_URL": "postgresql+asyncpg://nadie:nada@127.0.0.1:1/rikchay_prueba",
            "MEDIATECA_DIR": str(tmp_path / "mediateca"), "JWT_SECRET": SECRETO}


def test_sola_no_carga_nada_de_qillqa(tmp_path):
    codigo = ("import sys, json; import rikchay.sola as m; "
              "print(json.dumps({'ajenos': sorted(x for x in sys.modules if x == 'app' or x.startswith('app.')), "
              "'informe': m.app.state.anfitrion.informe(), 'capacidades': m.app.state.anfitrion.capacidades.ofrecidas()}))")
    r = subprocess.run([sys.executable, "-c", codigo], cwd=tmp_path, env=_entorno_limpio(tmp_path),
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    datos = json.loads(r.stdout.strip().splitlines()[-1])
    assert datos["ajenos"] == []                                                       # nada de Qillqa
    assert datos["informe"] == [{"id": "fototeca", "nombre": "Mediateca", "version": "0.1.0"}]
    assert set(datos["capacidades"]) == {"identidad.v1", "medios.v1", "medios.v2"}       # ni «semanas.v1» ni «etiquetas.v1»


def test_sola_atiende_con_su_propia_sesion(tmp_path, monkeypatch):
    """La aplicación sola, sin arrancar (no hay base aquí): sus rutas, su inicio de sesión y la identidad."""
    from fastapi.testclient import TestClient
    from tiqsi import Manifiesto
    from tiqsi.minimo import Cuentas, crear_app

    from rikchay.manifiesto import MANIFIESTO

    cuentas = tmp_path / "cuentas.json"
    Cuentas(cuentas).crear("ana", "clave-larga-1", "administrador", "Ana Pérez")
    copia = Manifiesto(**{**MANIFIESTO.__dict__, "al_arrancar": []})          # sin preparar la base
    c = TestClient(crear_app([copia], nombre="Mediateca", secreto=SECRETO, cuentas=cuentas))
    assert c.get("/api/health").json()["anfitrion"] == "Mediateca"
    assert c.get("/api/fototeca").status_code == 401
    assert c.post("/api/fototeca/importar-semanas").status_code == 401
    token = c.post("/api/auth/login", json={"usuario": "ana", "clave": "clave-larga-1"}).json()["token"]
    rutas = {r.path for r in c.app.routes}
    assert {"/api/fototeca", "/api/fototeca/subir", "/api/fototeca/{foto_id}", "/api/auth/login"} <= rutas
    assert token
