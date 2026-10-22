"""tests/test_fototeca.py — la Fototeca (2026-10-06): EXIF, geometría de los
ajustes no destructivos, filtros de la lista y el alta de un original (sin base)."""
import math
import os
from datetime import date

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:y@127.0.0.1/z")
os.environ.setdefault("JWT_SECRET", "prueba")

from sqlalchemy.dialects import postgresql  # noqa: E402

from rikchay.config import config  # noqa: E402  (la configuración propia de la Mediateca, fase 10.2b)
from rikchay import fototeca as ft  # noqa: E402


# --- Ajustes ---------------------------------------------------------------------------------


def test_ajustes_neutros_se_descartan():
    assert ft.normalizar_ajustes({"rotar": 0, "brillo": 1, "recorte": [0, 0, 1, 1], "voltear": False}) == {}
    assert ft.clave_ajustes({}) == "0"
    assert ft.clave_ajustes({"brillo": 1.0}) == "0"


def test_ajustes_se_acotan():
    a = ft.normalizar_ajustes({"rotar": 450, "enderezar": 99, "brillo": 7, "contraste": "x",
                               "recorte": [0.8, -0.2, 0.5, 2], "voltear": 1})
    assert a["rotar"] == 90
    assert a["enderezar"] == 45
    assert a["brillo"] == 2
    assert "contraste" not in a
    assert a["voltear"] is True
    # El recorte no sale de la foto: x + ancho ≤ 1, y + alto ≤ 1.
    x, y, w, h = a["recorte"]
    assert (x, y) == (0.8, 0.0) and math.isclose(x + w, 1.0) and math.isclose(h, 1.0)


def test_rotacion_invalida_y_recorte_minusculo():
    assert ft.normalizar_ajustes({"rotar": 45, "recorte": [0.1, 0.1, 0.001, 0.5]}) == {}


def test_clave_cambia_con_los_ajustes():
    assert ft.clave_ajustes({"rotar": 90}) != ft.clave_ajustes({"rotar": 180})
    assert ft.clave_ajustes({"brillo": 1.2, "rotar": 90}) == ft.clave_ajustes({"rotar": 90, "brillo": 1.2})


# --- Geometría ---------------------------------------------------------------------------------


def test_escala_enderezar():
    assert ft.escala_enderezar(3000, 2000, 0) == 1.0
    e = ft.escala_enderezar(3000, 2000, 5)
    assert 0.85 < e < 1.0
    # Simétrica: enderezar a la izquierda pierde lo mismo que a la derecha.
    assert math.isclose(e, ft.escala_enderezar(3000, 2000, -5))
    # Un cuadrado girado 45° conserva 1/√2 del lado.
    assert math.isclose(ft.escala_enderezar(100, 100, 45), 1 / math.sqrt(2), rel_tol=1e-9)


def test_encuadre_y_proporcion():
    assert ft.encuadre(3000, 2000, {"rotar": 90}) == (2000, 3000)
    w, h = ft.encuadre(3000, 2000, {"recorte": [0, 0, 0.5, 0.5]})
    assert (w, h) == (1500, 1000)
    # Enderezar conserva la proporción.
    assert math.isclose(ft.proporcion(3000, 2000, {"enderezar": 7}), 1.5, rel_tol=1e-3)
    assert ft.proporcion(3000, 2000, {"rotar": 270}) == round(2000 / 3000, 4)


def test_caja_recorte_dentro_de_la_imagen():
    assert ft.caja_recorte(1000, 500, [0.1, 0.2, 0.5, 0.6]) == (100, 100, 600, 400)
    izq, arr, der, aba = ft.caja_recorte(10, 10, [0.99, 0.99, 0.01, 0.01])
    assert 0 <= izq < der <= 10 and 0 <= arr < aba <= 10


def test_caja_proporcion_centrada():
    # 3:2 desde un 4:3 horizontal: recorta arriba y abajo.
    assert ft.caja_proporcion(4000, 3000, 1.5) == (0, 166, 4000, 166 + 2667)
    # 9:16 desde un horizontal: franja central.
    izq, arr, der, aba = ft.caja_proporcion(1920, 1080, 9 / 16)
    assert (arr, aba) == (0, 1080) and math.isclose((der - izq) / 1080, 9 / 16, rel_tol=0.01)
    assert izq == (1920 - (der - izq)) // 2


# --- EXIF --------------------------------------------------------------------------------------


def test_fecha_exif():
    f = ft.fecha_exif("2026:09:14 10:32:05")
    assert (f.year, f.month, f.day, f.hour, f.minute) == (2026, 9, 14, 10, 32)
    assert f.tzinfo is not None
    con_desfase = ft.fecha_exif("2026:09:14 10:32:05", "-05:00")
    assert con_desfase.utcoffset().total_seconds() == -5 * 3600
    assert ft.fecha_exif("0000:00:00 00:00:00") is None
    assert ft.fecha_exif("1970:01:01 00:00:00") is None
    assert ft.fecha_exif("") is None
    assert ft.fecha_exif("ayer") is None


def test_fecha_del_nombre():
    def hm(n):
        f = ft.fecha_del_nombre(n)
        return f and (f.year, f.month, f.day, f.hour, f.minute, f.second)
    assert hm("IMG_20261014_103205.jpg") == (2026, 10, 14, 10, 32, 5)
    assert hm("WhatsApp Image 2026-10-14 at 10.32.05.jpeg") == (2026, 10, 14, 10, 32, 5)
    assert hm("Screenshot_2026-10-14-10-32-05.png") == (2026, 10, 14, 10, 32, 5)
    assert hm("PXL_20261014_103205123.jpg") == (2026, 10, 14, 10, 32, 5)
    assert hm("IMG-20261014-WA0001.jpg") == (2026, 10, 14, 0, 0, 0)
    assert ft.fecha_del_nombre("IMG-20261014-WA0001.jpg").tzinfo is not None
    assert ft.fecha_del_nombre("DSC_0042.JPG") is None
    assert ft.fecha_del_nombre("foto 12345678.jpg") is None
    assert ft.fecha_del_nombre("") is None


def test_gps_decimal():
    assert ft.gps_decimal(((12, 1), (3, 1), (3050, 100)), "S") == round(-(12 + 3 / 60 + 30.5 / 3600), 7)
    assert ft.gps_decimal((77.0, 2.0, 0.0), "W") == round(-(77 + 2 / 60), 7)
    assert ft.gps_decimal((1, 2), "N") is None


# --- Listas, vínculos y filtros -----------------------------------------------------------------


def test_normalizar_lista():
    assert ft.normalizar_lista([" Huanta ", "huanta", "", "Pleno  del  Congreso", None]) == ["Huanta", "Pleno del Congreso"]


def test_vinculos():
    assert ft.parsear_vinculo("semana:3") == ("semana", 3)
    assert ft.parsear_vinculo("proyecto") == ("proyecto", None)
    assert ft.parsear_vinculo("otra:3") is None
    assert ft.parsear_vinculo("semana:x") is None
    v = ft.con_vinculo([], {"tipo": "semana", "id": 2, "codigo": "F-001", "etiqueta": "SR-02"})
    v = ft.con_vinculo(v, {"tipo": "semana", "id": 2, "codigo": "F-004", "etiqueta": None})
    assert v == [{"tipo": "semana", "id": 2, "codigo": "F-004", "etiqueta": "SR-02"}]
    assert len(ft.con_vinculo(v, {"tipo": "proyecto", "id": 2})) == 2


def test_leer_filtros_ignora_lo_invalido():
    f = ft.leer_filtros(album="ninguno", estado="borrada", desde="2026-13-01", hasta="2026-10-06",
                        mes="2026-9", vinculo="semana:4")
    assert f.album == 0 and f.estado == "" and f.desde is None and f.hasta == date(2026, 10, 6)
    assert f.mes == "" and f.vinculo == ("semana", 4)
    assert ft.leer_filtros(album="12").album == 12


def _sql(f: ft.Filtros) -> str:
    """El SQL y sus parámetros (JSONB no admite valores literales al compilar)."""
    partes = []
    for c in ft.condiciones(f):
        compilado = c.compile(dialect=postgresql.dialect())
        partes.append(f"{compilado} {compilado.params!r}")
    return " ".join(partes)


def test_condiciones():
    base = _sql(ft.Filtros())
    assert "eliminada_en IS NULL" in base
    assert "eliminada_en IS NOT NULL" in _sql(ft.Filtros(papelera=True))
    texto = _sql(ft.Filtros(q="Visita HUÁNUCO"))
    # El índice de texto: cada palabra sin tildes, en minúsculas y por prefijo, todas a la vez.
    assert "busqueda @@ to_tsquery" in texto and "'visita:* & huanuco:*'" in texto
    assert "album_id IS NULL" in _sql(ft.Filtros(album=0))
    assert "@>" in _sql(ft.Filtros(etiqueta="Pleno"))
    assert "@>" in _sql(ft.Filtros(vinculo=("semana", 3)))
    assert "to_char" in _sql(ft.Filtros(mes="2026-09"))
    # Solo letras y cifras llegan a to_tsquery: los signos escritos por la persona no se interpretan.
    assert "'100:*'" in _sql(ft.Filtros(q="100%"))
    assert "to_tsquery" not in _sql(ft.Filtros(q="%%! ¿?"))


def test_palabras_busqueda_como_el_indice():
    # Lo mismo que hace EXPR_BUSQUEDA en la base: minúsculas, sin tildes, todo signo es un corte.
    assert ft.palabras_busqueda("SR-05 · IMG_2034.JPG Ñuñoa Huánuco") == ["sr", "05", "img", "2034", "jpg", "nunoa", "huanuco"]
    assert ft.consulta_texto("Pleno 2026") == "pleno:* & 2026:*"
    from rikchay.modelos import EXPR_BUSQUEDA, INDICES, TILDES
    assert f"'{TILDES[0]}', '{TILDES[1]}'" in EXPR_BUSQUEDA and "'simple'" in EXPR_BUSQUEDA
    # La columna se añade antes de crear su índice.
    orden = [i for i, x in enumerate(INDICES) if "busqueda" in x]
    assert "ADD COLUMN IF NOT EXISTS busqueda" in INDICES[orden[0]] and "gin (busqueda)" in INDICES[orden[1]]


def test_filtros_facetados():
    f = ft.leer_filtros(anio="2026", lugar=" Huamanga ", calificacion="4", camara="Canon EOS R6", uso="sin")
    assert (f.anio, f.lugar, f.calificacion, f.camara, f.uso) == (2026, "Huamanga", 4, "Canon EOS R6", "sin")
    malos = ft.leer_filtros(anio="26", calificacion="9", uso="quizá")
    assert (malos.anio, malos.calificacion, malos.uso) == (None, 0, "")
    sql = _sql(f)
    assert "EXTRACT(year" in sql and "calificacion >=" in sql and "fototeca_fotos.camara =" in sql
    # «Sin uso»: ni vínculos ni filas en media_usos.
    assert "NOT (jsonb_array_length" in sql and "media_usos" in sql


def test_cada_faceta_suelta_solo_su_filtro():
    f = ft.Filtros(anio=2026, camara="Canon EOS R6", persona="Ana", ambito="marca", categoria="logo")
    assert ft.filtros_de_faceta(f, "anio", None).anio is None
    suelto = ft.filtros_de_faceta(f, "camara", "")
    assert suelto.camara == "" and suelto.anio == 2026 and suelto.persona == "Ana"
    # Soltar el ámbito suelta también la categoría de la marca.
    amb = ft.filtros_de_faceta(f, "ambito", "todo")
    assert (amb.ambito, amb.categoria) == ("todo", "")
    consultas = ft.consultas_facetas(f)
    assert set(consultas) == {n for n, _, _ in ft.FACETAS}
    def sql(c):
        k = c.compile(dialect=postgresql.dialect())
        return f"{k} {k.params!r}"
    # La faceta de cámara no filtra por cámara, pero sí por persona y año; la de año, al revés.
    camara = sql(consultas["camara"])
    assert "'Canon EOS R6'" not in camara and "Ana" in camara and "2026" in camara
    assert "'Canon EOS R6'" in sql(consultas["anio"])
    assert "jsonb_array_elements_text" in sql(consultas["persona"])


def test_seleccion_y_color():
    """La depuración de digiKam: aceptada / pendiente / rechazada y la etiqueta de color, con «sin marca»."""
    f = ft.leer_filtros(seleccion="aceptada", color="verde")
    assert (f.seleccion, f.color) == ("aceptada", "verde")
    # Lo desconocido se ignora; «ninguna» y «ninguno» son «sin marca».
    assert ft.leer_filtros(seleccion="borrada", color="fucsia").seleccion == ""
    assert ft.leer_filtros(color="fucsia").color == ""
    sql = _sql(ft.Filtros(seleccion="rechazada", color="rojo"))
    assert "seleccion" in sql and "'rechazada'" in sql and "'rojo'" in sql
    sin = _sql(ft.Filtros(seleccion="ninguna", color="ninguno"))
    assert "fototeca_fotos.seleccion = %(seleccion_1)s" in sin and "'seleccion_1': ''" in sin
    assert "'color_1': ''" in sin
    assert ft.SELECCIONES[0] == "" and "rechazada" in ft.SELECCIONES and "magenta" in ft.COLORES


def test_lote_valida_seleccion_y_color():
    from fastapi import HTTPException

    from rikchay import api

    api._depuracion("aceptada", "azul")
    api._depuracion("", "")
    for mal in (("aprobada", None), (None, "fucsia")):
        with pytest.raises(HTTPException) as e:
            api._depuracion(*mal)
        assert e.value.status_code == 422


# --- Alta y derivados con Pillow (sin base) ------------------------------------------------------


@pytest.fixture
def fototeca_tmp(tmp_path, monkeypatch):
    pytest.importorskip("PIL")
    monkeypatch.setattr(config, "mediateca_dir", str(tmp_path / "fototeca"))
    return tmp_path


def _foto_con_exif(ruta, tamano=(600, 400), orientacion=6):
    from PIL import Image
    from PIL.ExifTags import IFD

    img = Image.new("RGB", tamano, (120, 30, 40))
    exif = Image.Exif()
    exif[271] = "Canon"
    exif[272] = "Canon EOS R6"
    exif[274] = orientacion  # 6 = girar 90° horario al mostrar
    exif.get_ifd(IFD.Exif)[36867] = "2026:09:14 10:32:05"
    exif.get_ifd(IFD.GPSInfo).update({1: "S", 2: (12.0, 3.0, 30.5), 3: "W", 4: (75.0, 12.0, 0.0)})
    img.save(ruta, "JPEG", exif=exif)


def test_leer_archivo_y_derivados(fototeca_tmp):
    ruta = fototeca_tmp / "IMG_0001.JPG"
    _foto_con_exif(ruta)
    leido = ft.leer_archivo(ruta)
    # Medidas ya giradas por la orientación EXIF.
    assert (leido.ancho, leido.alto) == (400, 600)
    assert leido.extension == ".jpg" and leido.camara == "Canon EOS R6"
    assert leido.tomada_en.year == 2026 and leido.lat < 0 and leido.lon < 0
    rel = ft.guardar_original(ruta, leido, mover=False)
    assert rel == "2026/20260914_103205.jpg" and ruta.is_file()  # fecha de la toma (EXIF), por año

    mini = ft.derivado(rel, leido.sha256, {"rotar": 90}, "miniatura")
    from PIL import Image

    with Image.open(mini) as m:
        assert m.size == (400, 267)  # 600×400 tras girar, reducida a 400 de lado mayor
    # Exportar a 1:1 recorta al centro y no agranda.
    cuad = ft.exportar(rel, leido.sha256, {}, "cuadrada")
    with Image.open(cuad) as c:
        assert c.size == (400, 400)
    # El original no cambió.
    assert ft.huella(ft.ruta_original(rel))[0] == leido.sha256


def test_aplicar_ajustes_geometria(fototeca_tmp):
    from PIL import Image

    img = Image.new("RGB", (300, 200), (200, 200, 200))
    salida = ft.aplicar_ajustes(img, {"rotar": 90, "recorte": [0, 0, 0.5, 0.5]})
    assert salida.size == (100, 150)
    w, h = ft.encuadre(300, 200, {"enderezar": 10})
    girada = ft.aplicar_ajustes(img, {"enderezar": 10})
    assert abs(girada.width - w) <= 2 and abs(girada.height - h) <= 2


# --- Mediateca central (2026-10-19): nombres por fecha y de la marca --------------------------------


def test_nombre_por_fecha_por_anio_y_sin_pisar():
    from datetime import datetime

    momento = datetime(2026, 10, 18, 18, 25, 30, tzinfo=ft.zona())
    ocupados = {"2026/20261018_182530.jpg", "2026/20261018_182530_2.jpg"}
    assert ft.nombre_por_fecha(momento, ".JPEG", lambda r: False) == "2026/20261018_182530.jpg"
    assert ft.nombre_por_fecha(momento, ".jpg", ocupados.__contains__) == "2026/20261018_182530_3.jpg"
    assert ft.nombre_por_fecha(momento, ".mp4", lambda r: False) == "2026/20261018_182530.mp4"


def test_slug_marca():
    assert ft.slug_marca("CR - IMAGOTIPO-FONDO1") == "cr-imagotipo-fondo-1"
    assert ft.slug_marca("ÁREA DE EDUCACIÓN CIUDADANA") == "area-de-educacion-ciudadana"
    assert ft.slug_marca("Logos Firmeza y Seguridad sin fondo_2") == "logos-firmeza-y-seguridad-sin-fondo-2"


def test_ruta_original_no_sale_de_la_mediateca_ni_entra_a_la_cache():
    with pytest.raises(ft.ErrorFototeca):
        ft.ruta_original("../fuera.jpg")
    with pytest.raises(ft.ErrorFototeca):
        ft.ruta_original("cache/miniatura/ab/x.jpg")
    assert ft.ruta_original("2026/20261018_182530.jpg").name == "20261018_182530.jpg"


def test_avif_se_admite():
    # 2026-10-19: el banco traía un .avif que el plan no contemplaba; Pillow lo lee.
    assert ft.admitido("foto.avif") and ft.admitido("FOTO.AVIF")


# --- Personas y caras (2026-10-19) ----------------------------------------------------------------


def test_caja_de_cara_normalizada():
    from rikchay import caras as cr

    assert cr.normalizar_caja(0.9, -0.1, 0.4, 0.3) == (0.9, 0.0, pytest.approx(0.1), 0.3)
    with pytest.raises(ValueError):
        cr.normalizar_caja(0.5, 0.5, 0.004, 0.2)  # un clic sin arrastrar


def test_recorte_por_cara_cuadrado_y_dentro_de_la_foto():
    from rikchay import caras as cr

    izq, arr, der, aba = cr.caja_recorte(1600, 1000, (0.45, 0.4, 0.1, 0.16))
    assert der - izq == aba - arr  # cuadrado
    assert izq <= 0.45 * 1600 and der >= 0.55 * 1600 and arr <= 0.4 * 1000 and aba >= 0.56 * 1000
    # Junto al borde se corre hacia adentro en vez de salirse o achicarse.
    izq, arr, der, aba = cr.caja_recorte(1600, 1000, (0.0, 0.0, 0.1, 0.16))
    assert (izq, arr) == (0, 0) and der - izq == aba - arr > 0.16 * 1000
    # Una cara enorme no pide más que la foto.
    izq, arr, der, aba = cr.caja_recorte(800, 600, (0.0, 0.0, 1.0, 1.0))
    assert (der - izq, aba - arr) == (600, 600) and der <= 800


def test_propuestas_que_no_pisan_caras_marcadas():
    from rikchay import caras as cr

    assert cr.solapa((0, 0, 0.2, 0.2), (0, 0, 0.2, 0.2)) == pytest.approx(1)
    assert cr.solapa((0, 0, 0.1, 0.1), (0.5, 0.5, 0.1, 0.1)) == 0
    propuestas = [{"x": 0.1, "y": 0.1, "ancho": 0.2, "alto": 0.2}, {"x": 0.6, "y": 0.1, "ancho": 0.2, "alto": 0.2}]
    assert cr.propuestas_nuevas(propuestas, [(0.11, 0.1, 0.2, 0.2)]) == [propuestas[1]]


def test_nombres_de_la_foto_sin_duplicar():
    from rikchay import caras as cr

    assert cr.nombres_con(["Ana"], "ana") == ["Ana"]
    assert cr.nombres_con(["Ana"], "Luis") == ["Ana", "Luis"]
    assert cr.nombres_sin(["Ana", "Luis"], "ANA") == ["Luis"]
    assert cr.limpiar_nombre("  Ana   María ") == "Ana María"


def test_sin_opencv_la_deteccion_dice_por_que(tmp_path, monkeypatch):
    from rikchay import caras as cr

    try:
        import cv2  # noqa: F401
        pytest.skip("la API trae OpenCV")
    except ImportError:
        pass
    monkeypatch.setattr(config, "caras_python", str(tmp_path / "no-hay-python"))
    monkeypatch.setattr(config, "caras_modelo", "")
    cr.detector.cache_clear()
    try:
        estado = cr.detector()
        assert estado["disponible"] is False and estado["motivo"]
        with pytest.raises(RuntimeError):
            cr.detectar(tmp_path / "x.jpg")
    finally:
        cr.detector.cache_clear()


def test_detector_propone_sobre_un_retrato(monkeypatch):
    """Con un Python que traiga OpenCV y el modelo YuNet (CARAS_MODELO), encuentra la cara del retrato de dominio
    público de scikit-image. Sin ellos se salta: la detección es opcional."""
    import shutil
    import subprocess

    from rikchay import caras as cr

    python = shutil.which("python3")
    modelo = os.environ.get("CARAS_MODELO", "")
    if not python or not modelo or subprocess.run([python, "-I", str(cr.DETECTOR), "--probar", modelo],
                                                  capture_output=True).returncode != 0:
        pytest.skip("sin OpenCV o sin el modelo de caras")
    retrato = subprocess.run([python, "-I", "-c", "import skimage, os; print(os.path.join(os.path.dirname(skimage.__file__), 'data', 'astronaut.png'))"],
                             capture_output=True, text=True).stdout.strip()
    if not retrato or not os.path.isfile(retrato):
        pytest.skip("sin el retrato de prueba")
    monkeypatch.setattr(config, "caras_python", python)
    monkeypatch.setattr(config, "caras_modelo", modelo)
    cr.detector.cache_clear()
    try:
        assert cr.detector()["disponible"] is True
        caras = cr.detectar(retrato)
    finally:
        cr.detector.cache_clear()
    assert len(caras) == 1
    c = caras[0]
    assert 0.3 < c["x"] < 0.4 and 0.1 < c["ancho"] < 0.3 and c["confianza"] > 0.8


# --- Lugares con nombre (2026-10-19) --------------------------------------------------------------


def test_distancia_y_lugar_que_contiene_el_punto():
    from types import SimpleNamespace as L

    from rikchay import lugares as lg

    # Un grado de latitud ≈ 111 km; dos puntos de la Plaza de Armas de Huamanga a ~100 m.
    assert lg.distancia_m(0, 0, 1, 0) == pytest.approx(111_195, rel=1e-3)
    assert 80 < lg.distancia_m(-13.1588, -74.2232, -13.1597, -74.2232) < 120
    plaza = L(id=1, lat=-13.1588, lon=-74.2232, radio_m=150)
    grande = L(id=2, lat=-13.16, lon=-74.22, radio_m=5000)
    sin = L(id=3, lat=None, lon=None, radio_m=100)
    # Dentro de los dos: gana el de centro más cercano; fuera de todos o sin GPS, ninguno.
    assert lg.lugar_de(-13.1590, -74.2233, [grande, plaza, sin]) is plaza
    assert lg.lugar_de(-13.17, -74.21, [plaza, grande]) is grande
    assert lg.lugar_de(-12.04, -77.04, [plaza, grande]) is None
    assert lg.lugar_de(None, -74.2, [plaza]) is None


def test_radio_y_caja_del_lugar():
    from rikchay import lugares as lg

    assert lg.radio_valido(0) == 200 and lg.radio_valido(3) == lg.RADIO_MIN and lg.radio_valido(10**9) == lg.RADIO_MAX
    la0, la1, lo0, lo1 = lg.caja_alrededor(-13.16, -74.22, 1000)
    # La caja contiene el círculo: sus bordes quedan a ≥ 1 km del centro.
    assert lg.distancia_m(-13.16, -74.22, la1, -74.22) == pytest.approx(1000, rel=1e-3)
    assert lg.distancia_m(-13.16, -74.22, -13.16, lo1) >= 999


def test_filtro_por_ids_de_un_punto_del_mapa():
    f = ft.leer_filtros(ids="3, 8,x,15")
    assert f.ids == [3, 8, 15]
    assert len(ft.leer_filtros(ids=",".join(str(i) for i in range(900))).ids) == 500


# --- Versiones (2026-10-19) -------------------------------------------------------------------------


def test_cada_original_dice_cuantas_versiones_tiene():
    import asyncio

    from rikchay import api

    class Sesion:
        async def execute(self, consulta):
            self.sql = str(consulta)

            class R:
                def all(self):
                    return [(2, 3)]
            return R()

    sesion = Sesion()
    fichas = [{"id": 1}, {"id": 2}]
    asyncio.run(api._con_versiones(sesion, fichas))
    assert [f["n_versiones"] for f in fichas] == [0, 3]
    assert "media_versiones.original_id IN" in sesion.sql
    vacias: list = []
    asyncio.run(api._con_versiones(sesion, vacias))  # sin fotos no consulta
    assert vacias == []


# --- Parecidas por huella perceptual (2026-10-20) ------------------------------------------------------


def _escena(semilla: int, tamano=(800, 600)):
    import random

    from PIL import Image, ImageDraw

    r = random.Random(semilla)
    img = Image.new("RGB", tamano, (r.randint(0, 255), r.randint(0, 255), r.randint(0, 255)))
    d = ImageDraw.Draw(img)
    for _ in range(12):
        x, y = r.randint(0, tamano[0]), r.randint(0, tamano[1])
        d.rectangle([x, y, x + r.randint(60, 300), y + r.randint(60, 300)], fill=(r.randint(0, 255), r.randint(0, 255), r.randint(0, 255)))
    return img


def test_huella_perceptual_resiste_recodificar_y_reducir(tmp_path):
    pytest.importorskip("PIL")
    import io

    from PIL import Image

    from rikchay import parecidas as pr

    original = _escena(1)
    h = pr.dhash(original)
    assert len(h) == 16 and int(h, 16) >= 0
    # La misma escena re-codificada con mala calidad y reducida (como la manda WhatsApp): casi la misma huella.
    buf = io.BytesIO()
    original.resize((320, 240)).save(buf, "JPEG", quality=35)
    whatsapp = Image.open(io.BytesIO(buf.getvalue()))
    assert pr.distancia(h, pr.dhash(whatsapp)) <= pr.UMBRALES["muy"]
    # Otra escena: lejos.
    assert pr.distancia(h, pr.dhash(_escena(2))) > pr.UMBRALES["algo"]
    assert pr.distancia(h, h) == 0


def test_agrupar_parecidas_sin_encadenar():
    from rikchay import parecidas as pr

    a, b, c = "0000000000000001", "000000000000000f", "00000000000003ff"  # a–b: 3 bits; b–c: 6; a–c: 9
    lejos = "fffffffffffffff0"
    # El grupo nace de la más antigua y suma solo lo cercano a ELLA: c no entra por parecerse a b.
    assert pr.agrupar([(1, a), (2, b), (3, c), (4, lejos), (5, "")], 4) == [[1, 2]]
    assert pr.agrupar([(1, a), (2, b), (3, c)], 9) == [[1, 2, 3]]
    assert pr.agrupar([(1, a), (2, b)], 2) == []
    # De más grande a más chico.
    assert pr.agrupar([(9, lejos), (8, "fffffffffffffff1"), (1, a), (2, b), (3, "0000000000000003")], 4) == [[1, 2, 3], [8, 9]]


def test_una_imagen_plana_no_tiene_huella():
    pytest.importorskip("PIL")
    from PIL import Image

    from rikchay import parecidas as pr

    assert pr.dhash(Image.new("RGB", (640, 480), (120, 30, 40))) == ""
    assert pr.dhash(_escena(3)) != ""


def test_huella_de_un_archivo_que_no_abre_es_vacia(fototeca_tmp):
    from rikchay import parecidas as pr

    (fototeca_tmp / "fototeca" / "2026").mkdir(parents=True)
    (fototeca_tmp / "fototeca" / "2026" / "roto.jpg").write_bytes(b"no es una imagen")
    assert pr.huella_de("2026/roto.jpg") == ""
