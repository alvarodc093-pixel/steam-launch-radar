"""Reseñas de Steam agregadas por día (`IUserReviewsService/GetAppReviews`).

Dos comportamientos de la API sin clave, comprobados en octubre de 2026,
condicionan la descarga:

- Solo devuelve reseñas escritas en inglés, sea cual sea el parámetro
  `language`. El proyecto trabaja por tanto con reseñas en inglés, tanto en la
  lectura del radar como en el objetivo a 30 días.
- Sin `day_range`, `filter=recent` se queda en las reseñas recientes. Con el
  máximo permitido devuelve todo el histórico, de la más nueva a la más
  antigua, así que para llegar a los primeros días hay que recorrerlo entero.

De cada reseña solo se usan la fecha y el voto: el texto y el `steamid` se
descartan al leer la página y nunca se escriben en disco.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from radar.ingesta.http import ClienteHttp, ErrorFuente

logger = logging.getLogger(__name__)

URL = "https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/"
PAUSA_S = 0.4
POR_PAGINA = 100
TODO_EL_HISTORICO = 9_223_372_036_854_775_807  # valor máximo de day_range
MAX_PAGINAS = 200  # tope de seguridad por si el cursor no termina nunca


def agregar_por_dia(reviews: list[dict[str, Any]]) -> dict[str, list[int]]:
    """{fecha UTC: [positivas, negativas]}; ignora reseñas sin fecha o voto."""
    dias: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in reviews:
        momento, voto = r.get("timestamp_created"), r.get("voted_up")
        if not isinstance(momento, int | float) or not isinstance(voto, bool):
            continue
        fecha = datetime.fromtimestamp(int(momento), tz=UTC).date().isoformat()
        dias[fecha][0 if voto else 1] += 1
    return dict(dias)


def descargar_resenas(cliente: ClienteHttp, appid: int, maximo: int) -> dict[str, Any]:
    """Recorre todas las páginas y devuelve el agregado diario.

    `completo` es False si el juego supera `maximo` reseñas (de las que sirve la
    API) o si se alcanza el tope de páginas: en ambos casos pueden faltar
    los primeros días y el juego no debe entrar en el modelo.
    """
    params: dict[str, Any] = {
        "appid": appid,
        "filter": "recent",
        "language": "all",
        "purchase_type": "all",
        "day_range": TODO_EL_HISTORICO,
        "num_per_page": POR_PAGINA,
        "cursor": "*",
    }
    dias: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    vistas: set[str] = set()
    cursores: set[str] = set()
    total_api = None
    terminado = False

    for _ in range(MAX_PAGINAS):
        datos = cliente.get_json(URL, params=params)
        respuesta = datos.get("response") if isinstance(datos, dict) else None
        if not isinstance(respuesta, dict):
            raise ErrorFuente(f"GetAppReviews sin 'response' para {appid}")
        if total_api is None:
            total_api = (respuesta.get("query_summary") or {}).get("total_reviews")
            if isinstance(total_api, int) and total_api > maximo:
                logger.info("%s: %s reseñas, por encima del máximo", appid, total_api)
                return {
                    "total_api": total_api,
                    "descargadas": 0,
                    "dias": {},
                    "completo": False,
                }

        pagina = respuesta.get("reviews") or []
        # El cursor de Steam a veces repite reseñas entre páginas.
        nuevas = [r for r in pagina if r.get("recommendationid") not in vistas]
        vistas.update(r.get("recommendationid") for r in nuevas)
        for fecha, (pos, neg) in agregar_por_dia(nuevas).items():
            dias[fecha][0] += pos
            dias[fecha][1] += neg

        cursor = respuesta.get("cursor")
        if not pagina or not cursor or cursor in cursores:
            terminado = True
            break
        cursores.add(cursor)
        params["cursor"] = cursor

    return {
        "total_api": total_api,
        "descargadas": len(vistas),
        "dias": dict(sorted(dias.items())),
        "completo": terminado,
    }
