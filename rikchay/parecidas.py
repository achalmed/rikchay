"""Fotos parecidas de la Mediateca (2026-10-20; docs/plataforma/mediateca-central.md de Qillqa §2.2): lo de digiKam que faltaba.

El SHA-256 ya impide guardar dos veces el MISMO archivo; esto encuentra las que se ven casi iguales aunque no lo
sean: la misma foto re-codificada por WhatsApp, reducida, con otro nombre o una ráfaga de la misma escena. Cada
foto lleva una HUELLA PERCEPTUAL (`fototeca_fotos.hash_perceptual`): el «dHash» de 64 bits, que compara el brillo
de cada píxel con el de su derecha en la foto reducida a 9 × 8 en grises; dos fotos parecidas difieren en pocos
bits (la distancia de Hamming). Reglas:

  - la huella se calcula al subir y, para lo de antes, cuando se piden las parecidas (por tandas, con su avance);
    NULL = aún sin calcular, '' = no se pudo (no es una imagen que se abra);
  - solo fotos de actividades, sin las versiones editadas (se parecen a su original por definición) ni lo que está
    en la papelera;
  - un grupo se muestra mientras tenga al menos dos fotos sin rechazar: «Quedarse con esta» acepta una y rechaza
    las demás (la depuración de digiKam), y el grupo queda resuelto. Nada se borra.

Las funciones puras van arriba y tienen prueba (tests/test_fototeca.py).
"""

from __future__ import annotations

UMBRALES = {"muy": 3, "parecidas": 6, "algo": 10}  # bits distintos de 64 (los usuales del dHash)
PLANA = 4  # si el brillo de la foto reducida varía menos que esto, no tiene detalle que comparar
TANDA = 150  # huellas por petición: el avance se ve y ninguna petición tarda demasiado


def dhash(img) -> str:
    """La huella de 64 bits (16 cifras hexadecimales) de una imagen de Pillow; '' si la imagen es plana (un color
    liso, una captura en blanco): todas darían la misma huella y saldrían «iguales» sin parecerse."""
    from PIL import Image

    g = img.convert("L").resize((9, 8), Image.Resampling.BOX)
    px = g.tobytes()  # un byte por píxel (modo L), fila por fila
    if max(px) - min(px) < PLANA:
        return ""
    bits = 0
    for fila in range(8):
        for col in range(8):
            bits = (bits << 1) | (px[fila * 9 + col] < px[fila * 9 + col + 1])
    return f"{bits:016x}"


def distancia(a: str, b: str) -> int:
    """Cuántos de los 64 bits difieren (0 = indistinguibles)."""
    return (int(a, 16) ^ int(b, 16)).bit_count()


def agrupar(huellas: list[tuple[int, str]], umbral: int) -> list[list[int]]:
    """Grupos de fotos parecidas: cada grupo nace de la foto más antigua (menor id) que aún no tiene grupo y suma las
    que están a lo sumo a `umbral` bits de ELLA. Sin encadenar (A se parece a B y B a C no junta A con C): así un
    umbral holgado no pega media Mediateca. Los grupos, de más grande a más chico; dentro, por id."""
    validas = sorted((i, int(h, 16)) for i, h in huellas if h)
    libres = dict(validas)
    salida = []
    for i, a in validas:
        if i not in libres:
            continue
        del libres[i]
        grupo = [i] + [j for j, b in libres.items() if (a ^ b).bit_count() <= umbral]
        for j in grupo[1:]:
            del libres[j]
        if len(grupo) > 1:
            salida.append(grupo)
    return sorted(salida, key=lambda g: (-len(g), g[0]))


def huella_de(archivo: str) -> str:
    """La huella de un original de la Mediateca; '' si no se pudo abrir."""
    from rikchay import fototeca as ft

    try:
        return dhash(ft.abrir(ft.ruta_original(archivo), 64))
    except Exception:  # noqa: BLE001 — un archivo raro no detiene la tanda: queda marcado como «no se pudo»
        return ""


# --- Base -------------------------------------------------------------------------------------


def _candidatas():
    """Las fotos que entran en la comparación: de actividades, sin versiones ni papelera."""
    from sqlalchemy import select

    from rikchay.modelos import Foto, Version

    return (Foto.eliminada_en.is_(None), Foto.medio == "foto", Foto.ambito == "actividad",
            Foto.id.not_in(select(Version.derivada_id)))


async def calcular_tanda(sesion, cuantas: int = TANDA) -> tuple[int, int]:
    """Calcula la huella de hasta `cuantas` fotos que no la tienen. Devuelve (calculadas, faltan)."""
    import asyncio

    from sqlalchemy import func, select

    from rikchay.modelos import Foto

    fotos = (await sesion.execute(
        select(Foto).where(*_candidatas(), Foto.hash_perceptual.is_(None)).order_by(Foto.id).limit(cuantas)
    )).scalars().all()
    for f in fotos:
        f.hash_perceptual = await asyncio.to_thread(huella_de, f.archivo)
    await sesion.commit()
    faltan = (await sesion.execute(
        select(func.count(Foto.id)).where(*_candidatas(), Foto.hash_perceptual.is_(None))
    )).scalar_one()
    return len(fotos), faltan


async def grupos(sesion, umbral: int) -> list[list]:
    """Los grupos de parecidas (como objetos Foto) con al menos dos fotos sin rechazar."""
    from sqlalchemy import select

    from rikchay.modelos import Foto

    filas = (await sesion.execute(
        select(Foto.id, Foto.hash_perceptual).where(*_candidatas(), Foto.hash_perceptual.isnot(None), Foto.hash_perceptual != "")
    )).all()
    ids = agrupar([(i, h) for i, h in filas], umbral)
    if not ids:
        return []
    fotos = {f.id: f for f in (await sesion.execute(select(Foto).where(Foto.id.in_([i for g in ids for i in g])))).scalars()}
    salida = []
    for g in ids:
        miembros = [fotos[i] for i in g if i in fotos]
        if sum(1 for f in miembros if f.seleccion != "rechazada") >= 2:
            salida.append(sorted(miembros, key=lambda f: (f.tomada_en, f.id)))
    return salida
