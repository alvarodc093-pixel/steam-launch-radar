"""Contraste de las reseñas con las ventas anunciadas."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from radar import config, ventas


def _datos():
    juegos = pd.DataFrame(
        {"appid": [1, 2], "fecha_lanzamiento": ["2026-01-01", "2026-01-01"]}
    )
    diarias = pd.DataFrame(
        {
            "appid": [1, 1, 1, 1, 2],
            "dia": [-3, 0, 1, 2, 0],  # las reseñas previas al lanzamiento no cuentan
            "resenas": [50, 10, 20, 30, 40],
        }
    )
    anuncios = pd.DataFrame(
        {
            "appid": [1, 2],
            "nombre": ["Solo PC", "Con consolas"],
            "fecha_dato": pd.to_datetime(["2026-01-03", "2026-01-02"]),
            "fecha_aproximada": [False, True],
            "unidades": [3000, 8000],
            "plataformas": ["Steam", "PC, PS5 y Xbox"],
            "cuota_pc": [1.0, np.nan],
            "fuente": ["a", "b"],
            "url": ["https://a", "https://b"],
        }
    )
    return anuncios, juegos, diarias


def test_contraste_cuenta_los_dias_completos():
    contraste = ventas.contrastar(*_datos()).set_index("appid")
    # Dos días completos: el 0 y el 1, como la lectura del radar.
    assert contraste.loc[1, "dia"] == 2
    assert contraste.loc[1, "resenas_ingles"] == 30
    assert contraste.loc[1, "copias_por_resena"] == 100
    assert contraste.loc[1, "copias_pc_por_resena"] == 100
    # Sin cuota de PC conocida no hay proporción comparable.
    assert pd.isna(contraste.loc[2, "copias_pc_por_resena"])
    assert contraste.loc[2, "fecha_aproximada"]


def test_resumen_separa_lanzamiento_y_primer_mes():
    contraste = pd.DataFrame(
        {
            "appid": [1, 2, 3, 4, 1],
            "dia": [3, 7, 60, 90, 5],
            "copias_pc_por_resena": [200.0, 100.0, 50.0, 40.0, None],
        }
    )
    r = ventas.resumen(contraste)
    assert r["cifras"] == 5
    assert r["juegos"] == 4
    assert r["con_cifra_de_pc"] == 4
    assert r["lanzamiento"] == {
        "juegos": 2,
        "mediana": 150.0,
        "minimo": 100.0,
        "maximo": 200.0,
    }
    assert r["despues_del_primer_mes"]["mediana"] == 45.0


def test_tabla_markdown():
    tabla = ventas.tabla_markdown(ventas.contrastar(*_datos()))
    assert "| [Solo PC](https://a) | 2 | 3.000 | Steam | 30 | 100 |" in tabla
    assert "| ~1 |" in tabla  # fecha aproximada
    assert "PC, PS5 y Xbox" in tabla  # las comas del texto no se tocan
    assert "| — |" in tabla


def test_el_dataset_real_es_coherente():
    anuncios = ventas.cargar_ventas()
    juegos = pd.read_csv(config.DIR_PROCESADO / "juegos.csv")
    assert not anuncios.duplicated(["appid", "fecha_dato"]).any()
    assert set(anuncios["appid"]) <= set(
        juegos.loc[juegos["estado"] == "apto", "appid"]
    )
    assert anuncios["url"].str.startswith("https://").all()
    assert anuncios["cuota_pc"].dropna().between(0, 1).all()
    diarias = pd.read_csv(config.DIR_PROCESADO / "resenas_diarias.csv")
    contraste = ventas.contrastar(anuncios, juegos, diarias)
    assert (contraste["dia"] > 0).all()
    assert (contraste["resenas_ingles"] > 0).all()


def test_main_escribe_el_json(monkeypatch, tmp_path):
    salida = tmp_path / "ventas.json"
    monkeypatch.setattr(ventas, "RUTA_SALIDA", salida)
    ventas.main()
    texto = salida.read_text(encoding="utf-8")
    assert "NaN" not in texto  # el navegador no podría leerlo
    datos = json.loads(texto)
    assert datos["resumen"]["cifras"] == len(datos["juegos"])
    assert datos["resumen"]["juegos"] == len({j["appid"] for j in datos["juegos"]})
    assert all("url" in j for j in datos["juegos"])
