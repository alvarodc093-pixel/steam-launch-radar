"""Candidatos de la muestra: buscador de la tienda de Steam por fecha de lanzamiento.

`store.steampowered.com/search/results/?json=1&infinite=1` devuelve páginas de
100 juegos ordenados del lanzamiento más reciente al más antiguo, con el
número de reseñas en el texto de ayuda de cada fila. Así se recorren todos
los lanzamientos del periodo, y no solo los que ya tienen muchos
propietarios. La ruta /search/ no está excluida en el robots.txt de la tienda.
"""

from __future__ import annotations

import html
import re
from datetime import date
from typing import Any

from radar.ingesta.http import ClienteHttp
from radar.ingesta.tienda import parsear_fecha

URL = "https://store.steampowered.com/search/results/"
POR_PAGINA = 100
PAUSA_S = 1.6  # mismo ritmo que la ficha: comparten servidor

_FILA = re.compile(r'<a href="https://store\.steampowered\.com/app/.*?</a>', re.S)
_APPID = re.compile(r'data-ds-appid="(\d+)"')
_TITULO = re.compile(r'<span class="title">(.*?)</span>', re.S)
_FECHA = re.compile(r"search_released[^>]*>\s*([^<]*?)\s*<", re.S)
_RESENAS = re.compile(r"the ([\d,]+) user reviews")


def parsear_pagina(html_resultados: str) -> list[dict[str, Any]]:
    """Filas de juego sueltas; los paquetes (varios appid) se ignoran."""
    filas = []
    for bloque in _FILA.findall(html_resultados.replace("\\/", "/")):
        appid = _APPID.search(bloque)
        if not appid:
            continue
        titulo = _TITULO.search(bloque)
        fecha = _FECHA.search(bloque)
        resenas = _RESENAS.search(bloque)
        filas.append(
            {
                "appid": int(appid.group(1)),
                "nombre": html.unescape(titulo.group(1)).strip() if titulo else None,
                "fecha": parsear_fecha(fecha.group(1)) if fecha else None,
                # Sin texto de ayuda Steam aún no muestra puntuación (< 10 reseñas).
                # Con muchas reseñas, el texto solo cuenta las del idioma de la
                # consulta («reviews written in your language»), aquí inglés.
                "resenas_tienda": int(resenas.group(1).replace(",", ""))
                if resenas
                else 0,
            }
        )
    return filas


def descargar_pagina(cliente: ClienteHttp, inicio: int) -> list[dict[str, Any]]:
    respuesta = cliente.get_json(
        URL,
        params={
            "query": "",
            "start": inicio,
            "count": POR_PAGINA,
            "sort_by": "Released_DESC",
            "category1": 998,  # solo juegos (sin DLC, bandas sonoras ni software)
            "json": 1,
            "infinite": 1,
            "cc": "us",
            "l": "english",
        },
    )
    return parsear_pagina(
        respuesta.get("results_html", "") if isinstance(respuesta, dict) else ""
    )


def es_candidato(
    fila: dict[str, Any], desde: date, hasta: date, resenas_min: int, resenas_max: int
) -> bool:
    fecha = fila.get("fecha")
    return (
        fecha is not None
        and desde <= fecha <= hasta
        and resenas_min <= fila["resenas_tienda"] <= resenas_max
    )
