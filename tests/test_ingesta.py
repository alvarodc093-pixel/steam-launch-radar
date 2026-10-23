"""Parsers y paginación de la ingesta, con respuestas simuladas (sin red)."""

from __future__ import annotations

from datetime import date

import pytest
import responses

from radar.ingesta import resenas, steamspy, tienda
from radar.ingesta.__main__ import en_ventana
from radar.ingesta.http import ClienteHttp, ErrorFuente


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("Sep 17, 2020", date(2020, 9, 17)),
        ("17 Sep, 2020", date(2020, 9, 17)),
        ("Sept 5, 2025", date(2025, 9, 5)),
        ("Q1 2025", None),
        ("Coming soon", None),
        (None, None),
    ],
)
def test_parsear_fecha(texto, esperado) -> None:  # noqa: ANN001
    assert tienda.parsear_fecha(texto) == esperado


def _ficha(**datos):  # noqa: ANN003, ANN202
    base = {
        "type": "game",
        "name": "Juego",
        "release_date": {"coming_soon": False, "date": "Mar 3, 2025"},
        "price_overview": {"currency": "USD", "initial": 1999, "final": 999},
        "genres": [{"description": "Indie"}, {"description": "RPG"}],
    }
    base.update(datos)
    return {"10": {"success": True, "data": base}}


def test_ficha_usa_precio_sin_descuento() -> None:
    ficha = tienda.parsear_ficha(10, _ficha())
    assert ficha["precio_usd"] == 19.99  # initial, no el final rebajado
    assert ficha["fecha_lanzamiento"] == date(2025, 3, 3)
    assert ficha["generos"] == ["Indie", "RPG"]


def test_ficha_gratis_y_descartes() -> None:
    assert (
        tienda.parsear_ficha(10, _ficha(is_free=True, price_overview=None))[
            "precio_usd"
        ]
        == 0.0
    )
    assert tienda.parsear_ficha(10, _ficha(type="dlc")) is None
    assert tienda.parsear_ficha(10, {"10": {"success": False}}) is None
    otra_moneda = _ficha(price_overview={"currency": "EUR", "initial": 1999})
    assert tienda.parsear_ficha(10, otra_moneda)["precio_usd"] is None


def test_filtrar_candidatos_steamspy() -> None:
    pagina = {
        "1": {"appid": 1, "positive": 500, "negative": 10},  # appid antiguo
        "2500000": {"appid": 2500000, "positive": 25, "negative": 2},  # pocas
        "2600000": {"appid": 2600000, "positive": 900, "negative": 100},
        "2700000": {"appid": 2700000, "positive": 20000, "negative": 1},  # demasiadas
    }
    candidatos = steamspy.filtrar_candidatos(pagina, 30, 10_000)
    assert [c["appid"] for c in candidatos] == [2600000]


def test_agregar_por_dia_ignora_incompletas() -> None:
    dias = resenas.agregar_por_dia(
        [
            {"timestamp_created": 1735689600, "voted_up": True},  # 2025-01-01 UTC
            {"timestamp_created": 1735693200, "voted_up": False},
            {"timestamp_created": 1735776000, "voted_up": True},  # 2025-01-02
            {"timestamp_created": 1735776000},  # sin voto
        ]
    )
    assert dias == {"2025-01-01": [1, 1], "2025-01-02": [1, 0]}


@responses.activate
def test_descargar_resenas_pagina_y_deduplica() -> None:
    def pagina(ids, cursor, total=3):  # noqa: ANN001, ANN202
        return {
            "response": {
                "query_summary": {"total_reviews": total},
                "reviews": [
                    {
                        "recommendationid": i,
                        "timestamp_created": 1735689600,
                        "voted_up": True,
                    }
                    for i in ids
                ],
                "cursor": cursor,
            }
        }

    responses.get(resenas.URL, json=pagina(["a", "b"], "c1"))
    responses.get(resenas.URL, json=pagina(["b", "c"], "c2"))  # «b» repetida
    responses.get(resenas.URL, json=pagina([], "c3"))
    agregado = resenas.descargar_resenas(ClienteHttp(), 10, maximo=100)
    assert agregado["descargadas"] == 3
    assert agregado["dias"] == {"2025-01-01": [3, 0]}
    assert agregado["completo"] is True


@responses.activate
def test_descargar_resenas_por_encima_del_maximo() -> None:
    responses.get(
        resenas.URL,
        json={"response": {"query_summary": {"total_reviews": 50_000}, "reviews": []}},
    )
    agregado = resenas.descargar_resenas(ClienteHttp(), 10, maximo=10_000)
    assert agregado["completo"] is False
    assert len(responses.calls) == 1  # no recorre 500 páginas para nada


@responses.activate
def test_cliente_no_reintenta_un_404() -> None:
    responses.get("https://x.test/a", status=404)
    with pytest.raises(ErrorFuente):
        ClienteHttp().get_json("https://x.test/a")
    assert len(responses.calls) == 1


def test_en_ventana() -> None:
    hoy = date(2026, 10, 24)
    assert en_ventana({"fecha_lanzamiento": "2025-06-01"}, hoy)
    assert not en_ventana({"fecha_lanzamiento": "2023-12-31"}, hoy)
    assert not en_ventana(
        {"fecha_lanzamiento": "2026-10-01"}, hoy
    )  # sin 30 días + margen
    assert not en_ventana({"descartada": True}, hoy)
    assert not en_ventana(
        {"fecha_lanzamiento": "2025-06-01", "proximamente": True}, hoy
    )
