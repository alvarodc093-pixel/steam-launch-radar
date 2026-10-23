"""Candidatos de la muestra a partir del listado completo de SteamSpy.

`request=all` devuelve los juegos ordenados por propietarios estimados, en
páginas de 1.000. SteamSpy solo se usa para preseleccionar: la fecha de
lanzamiento y el precio salen después de la ficha oficial de la tienda.
"""

from __future__ import annotations

from typing import Any

from radar.ingesta.http import ClienteHttp

URL = "https://steamspy.com/api.php"
# SteamSpy limita `request=all` a una petición por minuto.
PAUSA_S = 61.0
# Los appid se asignan en orden de alta en Steamworks: por debajo de este
# valor (apps dadas de alta antes de 2022) casi no hay lanzamientos de 2024
# en adelante, y así se ahorran miles de consultas a la tienda.
APPID_MIN = 2_000_000


def filtrar_candidatos(
    pagina: dict[str, Any], resenas_min: int, resenas_max: int
) -> list[dict[str, Any]]:
    candidatos = []
    for fila in pagina.values():
        appid = int(fila.get("appid", 0))
        total = int(fila.get("positive") or 0) + int(fila.get("negative") or 0)
        if appid >= APPID_MIN and resenas_min <= total <= resenas_max:
            candidatos.append(
                {
                    "appid": appid,
                    "nombre_steamspy": fila.get("name"),
                    "resenas_steamspy": total,
                    "propietarios_steamspy": fila.get("owners"),
                }
            )
    return candidatos


def descargar_pagina(cliente: ClienteHttp, numero: int) -> dict[str, Any]:
    return cliente.get_json(URL, params={"request": "all", "page": numero})
