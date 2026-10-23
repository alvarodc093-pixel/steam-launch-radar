"""Ficha de la tienda de Steam (`store.steampowered.com/api/appdetails`).

Es la única fuente sin clave que da la fecha de lanzamiento real y el
precio de lista en dólares, las dos variables que un estudio conoce antes
de publicar.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from radar.ingesta.http import ClienteHttp

URL = "https://store.steampowered.com/api/appdetails"
# Con más de ~200 peticiones cada 5 minutos la tienda responde 429.
PAUSA_S = 1.6

# Steam escribe la fecha según el idioma y a veces sin día ("Oct 2024");
# esas se descartan porque el radar necesita el día exacto.
_FORMATOS_FECHA = ("%b %d, %Y", "%d %b, %Y", "%B %d, %Y", "%d %B, %Y")


def parsear_fecha(texto: str | None) -> date | None:
    if not texto:
        return None
    limpio = texto.strip().replace("Sept", "Sep")
    for formato in _FORMATOS_FECHA:
        try:
            return datetime.strptime(limpio, formato).date()
        except ValueError:
            continue
    return None


def parsear_ficha(appid: int, respuesta: Any) -> dict[str, Any] | None:
    """Campos de la ficha; None si Steam no tiene la app o no es un juego."""
    bloque = respuesta.get(str(appid)) if isinstance(respuesta, dict) else None
    if not bloque or not bloque.get("success"):
        return None
    datos = bloque.get("data") or {}
    if datos.get("type") != "game":
        return None

    lanzamiento = datos.get("release_date") or {}
    precio = datos.get("price_overview") or {}
    if datos.get("is_free"):
        precio_usd = 0.0
    elif isinstance(precio.get("initial"), int) and precio.get("currency") == "USD":
        # `initial` es el precio sin descuento; `final` cambia con las rebajas.
        precio_usd = precio["initial"] / 100
    else:
        precio_usd = None

    return {
        "appid": appid,
        "nombre": datos.get("name"),
        "fecha_lanzamiento": parsear_fecha(lanzamiento.get("date")),
        "proximamente": bool(lanzamiento.get("coming_soon")),
        "precio_usd": precio_usd,
        "gratis": bool(datos.get("is_free")),
        "generos": [
            g.get("description")
            for g in datos.get("genres", [])
            if g.get("description")
        ],
        "desarrolladores": datos.get("developers") or [],
        "editores": datos.get("publishers") or [],
    }


def descargar_ficha(cliente: ClienteHttp, appid: int) -> dict[str, Any] | None:
    respuesta = cliente.get_json(
        URL, params={"appids": appid, "cc": "us", "l": "english"}
    )
    return parsear_ficha(appid, respuesta)
