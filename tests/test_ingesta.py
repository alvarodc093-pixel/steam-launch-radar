"""Parsers y paginación de la ingesta, con respuestas simuladas (sin red)."""

from __future__ import annotations

import math
from datetime import date

import pytest
import responses

from radar.ingesta import busqueda, resenas, tienda
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


FILA = """
<a href="https://store.steampowered.com/app/{appid}/X/?snr=1" data-ds-appid="{appid}" class="search_result_row">
  <span class="title">{titulo}</span>
  <div class="search_released responsive_secondrow">{fecha}</div>
  {resenas}
</a>"""


def _fila(appid, titulo, fecha, n=None):  # noqa: ANN001, ANN202
    ayuda = (
        f'<span class="search_review_summary" data-tooltip-html="Very Positive&lt;br&gt;90% of the {n} user reviews for this game are positive."></span>'
        if n
        else ""
    )
    return FILA.format(appid=appid, titulo=titulo, fecha=fecha, resenas=ayuda)


def test_parsear_pagina_del_buscador() -> None:
    texto = (
        _fila(1, "Juego &amp; Cía", "Apr 26, 2026", "1,234")
        + _fila(2, "Sin reseñas", "Apr 25, 2026")
        + '<a href="https://store.steampowered.com/app/3/P/" data-ds-appid="3,4" class="x"></a>'
    )
    filas = busqueda.parsear_pagina(texto)
    assert filas == [
        {
            "appid": 1,
            "nombre": "Juego & Cía",
            "fecha": date(2026, 4, 26),
            "resenas_tienda": 1234,
        },
        {
            "appid": 2,
            "nombre": "Sin reseñas",
            "fecha": date(2026, 4, 25),
            "resenas_tienda": 0,
        },
    ]  # el paquete con varios appid no encaja en el patrón y se descarta


def test_es_candidato() -> None:
    desde, hasta = date(2025, 11, 1), date(2026, 9, 1)
    fila = {"appid": 1, "fecha": date(2026, 3, 1), "resenas_tienda": 200}
    assert busqueda.es_candidato(fila, desde, hasta, 50, 10_000)
    assert not busqueda.es_candidato(
        {**fila, "resenas_tienda": 20}, desde, hasta, 50, 10_000
    )
    assert not busqueda.es_candidato(
        {**fila, "fecha": date(2026, 9, 20)}, desde, hasta, 50, 10_000
    )
    assert not busqueda.es_candidato({**fila, "fecha": None}, desde, hasta, 50, 10_000)


def test_agregar_por_dia_ignora_incompletas() -> None:
    dias = resenas.agregar_por_dia(
        [
            {"timestamp_created": 1735689600, "voted_up": True},  # 2025-01-01 UTC
            {"timestamp_created": 1735693200, "voted_up": False},
            {"timestamp_created": 1735776000, "voted_up": True},  # 2025-01-02
            {"timestamp_created": 1735776000},  # sin voto
        ]
    )
    assert dias == {
        "2025-01-01": [1, 1, 0, 0, 0, 0, 0],
        "2025-01-02": [1, 0, 0, 0, 0, 0, 0],
    }


def test_agregar_por_dia_suma_las_senales_tempranas() -> None:
    base = {"timestamp_created": 1735689600, "voted_up": True}
    dias = resenas.agregar_por_dia(
        [
            {
                **base,
                "language": "english",
                "steam_purchase": True,
                "author": {"playtime_at_review": 60, "steamid": "76561198000000000"},
            },
            {
                **base,
                "voted_up": False,
                "language": "spanish",
                "received_for_free": True,
                "primarily_steam_deck": True,
                "author": {"playtime_at_review": 0},
            },
        ]
    )
    positivas, negativas, ingles, steam, gratis, deck, horas = dias["2025-01-01"]
    assert (positivas, negativas, ingles, steam, gratis, deck) == (1, 1, 1, 1, 1, 1)
    assert horas == pytest.approx(math.log1p(1), abs=1e-3)  # una hora y cero
    # Nada que identifique al autor llega al agregado.
    assert "76561198000000000" not in str(dias)


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
    assert agregado["dias"] == {"2025-01-01": [3, 0, 0, 0, 0, 0, 0]}
    assert agregado["completo"] is True
    assert agregado["formato"] == resenas.FORMATO
    assert agregado["idiomas"] == "ingles"
    assert "key=" not in responses.calls[0].request.url


@responses.activate
def test_con_clave_pide_todos_los_idiomas() -> None:
    responses.get(
        resenas.URL,
        json={"response": {"query_summary": {"total_reviews": 0}, "reviews": []}},
    )
    agregado = resenas.descargar_resenas(ClienteHttp(), 10, maximo=100, clave="abc")
    assert "key=abc" in responses.calls[0].request.url
    assert agregado["idiomas"] == "todos"


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
    assert en_ventana({"fecha_lanzamiento": "2026-06-01"}, hoy)
    # más de un año: su primer mes ya no lo sirve la API de reseñas
    assert not en_ventana({"fecha_lanzamiento": "2025-10-20"}, hoy)
    assert not en_ventana(
        {"fecha_lanzamiento": "2026-10-01"}, hoy
    )  # sin 30 días + margen
    assert not en_ventana({"descartada": True}, hoy)
    assert not en_ventana(
        {"fecha_lanzamiento": "2026-06-01", "proximamente": True}, hoy
    )


@responses.activate
def test_pide_todo_el_historico_y_marca_el_tope(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(resenas, "MAX_PAGINAS", 2)
    for i in range(3):
        responses.get(
            resenas.URL,
            json={
                "response": {
                    "query_summary": {"total_reviews": 999},
                    "reviews": [
                        {
                            "recommendationid": str(i),
                            "timestamp_created": 1735689600,
                            "voted_up": True,
                        }
                    ],
                    "cursor": f"c{i}",
                }
            },
        )
    agregado = resenas.descargar_resenas(ClienteHttp(), 10, maximo=10_000)
    assert "day_range=9223372036854775807" in responses.calls[0].request.url
    assert agregado["completo"] is False  # cortado por el tope, faltan páginas
    assert agregado["descargadas"] == 2
