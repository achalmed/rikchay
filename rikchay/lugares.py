"""Lugares con nombre de la Mediateca (2026-10-19; docs/plataforma/mediateca-central.md de Qillqa §2.2).

Además de las coordenadas de cada foto (las del GPS de la cámara), un LUGAR tiene nombre, centro y radio
(«Plaza de Armas de Huamanga», 150 m). Reglas:

  - una foto está en un lugar (`fototeca_fotos.lugar_id`) y su campo `lugar` lleva el nombre: es lo que se busca
    y se filtra (la faceta «Lugar»), así que renombrar un lugar renombra el de sus fotos;
  - una foto nueva con GPS dentro del radio de un lugar entra en él sola; las de antes se asignan desde el mapa
    («Asignar las cercanas»: primero dice cuántas, luego asigna), y nunca se pisa un lugar ya puesto;
  - escribir a mano otro lugar en la foto la saca del lugar con nombre (queda el texto).

Las funciones puras van arriba y tienen prueba (tests/test_fototeca.py).
"""

from __future__ import annotations

import math

RADIO_TIERRA_M = 6_371_000
RADIO_MIN, RADIO_MAX = 10, 50_000


def distancia_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia sobre la esfera (haversine), en metros."""
    f1, f2 = math.radians(lat1), math.radians(lat2)
    df, dl = f2 - f1, math.radians(lon2 - lon1)
    a = math.sin(df / 2) ** 2 + math.cos(f1) * math.cos(f2) * math.sin(dl / 2) ** 2
    return 2 * RADIO_TIERRA_M * math.asin(min(1.0, math.sqrt(a)))


def lugar_de(lat: float | None, lon: float | None, lugares) -> object | None:
    """El lugar cuyo radio contiene el punto; si hay varios, el de centro más cercano. Acepta objetos con
    `lat`, `lon` y `radio_m`."""
    if lat is None or lon is None:
        return None
    mejor, menor = None, math.inf
    for l in lugares:
        if l.lat is None or l.lon is None:
            continue
        d = distancia_m(lat, lon, l.lat, l.lon)
        if d <= (l.radio_m or 0) and d < menor:
            mejor, menor = l, d
    return mejor


def radio_valido(r: int | float | None) -> int:
    return int(min(max(int(r or 200), RADIO_MIN), RADIO_MAX))


def caja_alrededor(lat: float, lon: float, radio_m: float) -> tuple[float, float, float, float]:
    """(lat_min, lat_max, lon_min, lon_max) que contiene el círculo: el índice filtra antes de medir."""
    dlat = math.degrees(radio_m / RADIO_TIERRA_M)
    dlon = math.degrees(radio_m / (RADIO_TIERRA_M * max(math.cos(math.radians(lat)), 1e-6)))
    return lat - dlat, lat + dlat, lon - dlon, lon + dlon


# --- Base -------------------------------------------------------------------------------------


async def cercanas(sesion, lugar) -> list[int]:
    """Las fotos con GPS dentro del radio del lugar que aún no tienen lugar con nombre."""
    from sqlalchemy import select

    from rikchay.modelos import Foto

    la0, la1, lo0, lo1 = caja_alrededor(lugar.lat, lugar.lon, lugar.radio_m)
    filas = (await sesion.execute(
        select(Foto.id, Foto.lat, Foto.lon).where(
            Foto.eliminada_en.is_(None), Foto.lugar_id.is_(None), Foto.lat.between(la0, la1), Foto.lon.between(lo0, lo1))
    )).all()
    return [i for i, la, lo in filas if distancia_m(la, lo, lugar.lat, lugar.lon) <= lugar.radio_m]


async def asignar_si_cae(sesion, foto) -> None:
    """Una foto nueva con GPS entra en el lugar con nombre que la contiene (si no tiene uno)."""
    from sqlalchemy import select

    from rikchay.modelos import Lugar

    if foto.lugar_id is not None or foto.lat is None or foto.lon is None:
        return
    lugar = lugar_de(foto.lat, foto.lon, (await sesion.execute(select(Lugar))).scalars().all())
    if lugar is not None:
        foto.lugar_id = lugar.id
        if not foto.lugar:
            foto.lugar = lugar.nombre
