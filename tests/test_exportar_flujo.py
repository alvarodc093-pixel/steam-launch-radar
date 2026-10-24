"""Exportación completa sobre datos procesados sintéticos."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from radar import config, exportar


@pytest.fixture
def procesados(tmp_path: Path) -> Path:
    """Tres CSV con la misma forma que los de data/processed."""
    rng = np.random.default_rng(5)
    n = 160
    generos = rng.choice(["Action", "RPG", "Casual"], n, p=[0.5, 0.3, 0.2])
    fechas = pd.date_range("2025-11-01", periods=n, freq="2D")
    diarias = []
    filas = []
    for appid in range(n):
        por_dia = rng.poisson(rng.uniform(1, 30), 30) + (np.arange(30) < 3) * 10
        diarias += [(appid, d, int(v), 0, int(v)) for d, v in enumerate(por_dia) if v]
        acumulado = np.cumsum(por_dia)
        precio = float(rng.choice([0.0, 4.99, 19.99, 49.99]))
        filas.append(
            {
                "appid": appid,
                "nombre": f"Juego {appid}",
                "fecha_lanzamiento": fechas[appid],
                "precio_usd": precio,
                "gratis": precio == 0,
                "banda_precio": "gratis" if precio == 0 else "hasta_20",
                "genero_principal": generos[appid],
                "es_indie": True,
                "mes_lanzamiento": fechas[appid].month,
                "dia_semana_lanzamiento": fechas[appid].day_of_week,
                **{
                    c: v
                    for k in config.DIAS_LECTURA
                    for c, v in (
                        (f"resenas_{k}d", int(acumulado[k - 1])),
                        (f"pct_positivas_{k}d", 1.0),
                    )
                },
                "resenas_30d": int(acumulado[-1]),
            }
        )
    dataset = pd.DataFrame(filas)
    dataset.to_csv(tmp_path / "dataset_radar.csv", index=False)
    juegos = dataset[["appid", "nombre", "fecha_lanzamiento"]].assign(estado="apto")
    juegos.to_csv(tmp_path / "juegos.csv", index=False)
    pd.DataFrame(
        diarias, columns=["appid", "dia", "positivas", "negativas", "resenas"]
    ).to_csv(tmp_path / "resenas_diarias.csv", index=False)
    return tmp_path


def test_exportar_escribe_los_json_de_la_app(procesados, tmp_path_factory) -> None:  # noqa: ANN001
    salida = tmp_path_factory.mktemp("app_data")
    casos = salida / "casos.json"
    n = exportar.exportar(procesados, salida, casos)

    radar = json.loads((salida / "radar.json").read_text(encoding="utf-8"))
    assert set(radar["modelos"]) == {str(d) for d in config.DIAS_LECTURA}
    assert radar["cohortes"]["n_global"] == 96  # 60 % de 160
    assert len(radar["curva_tipica"]["global"]) == config.DIAS_VENTANA
    assert radar["curva_tipica"]["global"][-1] == 1.0
    assert len(radar["ejemplos"]) == 32  # el test: 20 % más reciente
    assert radar["ejemplos"][0]["acumuladas"][-1] == radar["ejemplos"][0]["resenas_30d"]

    previo = json.loads((salida / "previo.json").read_text(encoding="utf-8"))
    assert {g["genero"] for g in previo["por_genero"]} == {"Action", "RPG", "Casual"}
    mercado = json.loads((salida / "mercado.json").read_text(encoding="utf-8"))
    assert mercado["juegos_aptos"] == 160
    assert n == len(json.loads(casos.read_text(encoding="utf-8"))) == 32 * 4


def test_faltan_procesados(tmp_path, monkeypatch, caplog) -> None:  # noqa: ANN001
    with pytest.raises(FileNotFoundError, match="radar.preparacion"):
        exportar.cargar_procesados(tmp_path)
    monkeypatch.setattr(config, "DIR_PROCESADO", tmp_path)
    assert exportar.main() == 1
    assert "radar.preparacion" in caplog.text
