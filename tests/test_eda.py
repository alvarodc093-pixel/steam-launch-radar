"""Cifras del EDA que enseña la app y aciertos del veredicto."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from radar import config, eda, exportar


def test_epsilon_cuadrado():
    assert eda.epsilon_cuadrado(9.0, 10) == 1.0


def test_efecto_positivas_bajas_lee_el_residuo_en_porcentaje():
    # Volumen con un multiplicador exacto: sin positivas bajas, residuo cero.
    semana = np.array([10, 20, 40, 80, 160, 10, 20, 40])
    mes = np.expm1(np.log1p(semana) * 1.0 + 0.5)
    mes[5:] = np.expm1(np.log1p(semana[5:]) + 0.5 - 0.3)  # las de pocas positivas
    dataset = pd.DataFrame(
        {
            "resenas_7d": semana,
            "resenas_30d": mes,
            "pct_positivas_7d": [0.9, 0.95, 0.85, 0.92, 0.88, 0.5, 0.55, 0.4],
        }
    )
    efecto = eda.efecto_positivas_bajas(dataset)
    assert efecto["juegos"] == 3
    assert efecto["residuo_mediano_log"] < 0
    assert efecto["efecto"] == pytest.approx(
        np.expm1(efecto["residuo_mediano_log"]), abs=1e-3
    )


def test_hallazgos_del_dataset_real():
    dataset = pd.read_csv(config.DIR_PROCESADO / "dataset_radar.csv")
    h = eda.hallazgos(dataset)
    assert 0 < h["spearman_7_30"] <= 1
    assert -1 < h["positivas_bajas"]["efecto"] < 0  # pocas positivas, menos reseñas
    assert 0 <= h["epsilon2"]["genero"] < h["epsilon2"]["precio"] < 1


def test_aciertos_del_veredicto(monkeypatch):
    # Cohorte: a 30 días, cuartiles 10 y 100. Intervalo de ±log(2) en log1p.
    tabla = {"global": {"30": [1, 10, 50, 100, 500]}, "por_genero": {}}
    test = pd.DataFrame(
        {
            "genero_principal": ["Action"] * 4,
            "resenas_7d": [1, 2, 150, 20],
            "resenas_30d": [3, 400, 300, 40],
        }
    )
    estimados = np.log1p([3.0, 3.0, 300.0, 40.0])
    monkeypatch.setattr(exportar, "predecir_python", lambda res, x: estimados)
    res = SimpleNamespace(q90=np.log(2), generos=["Action"])
    aciertos = exportar.aciertos_veredicto({7: res}, test, tabla)["7"]
    # Dos «por debajo»: uno acierta y otro acaba muy por encima.
    assert aciertos["por_debajo"]["por_debajo"] == 1
    assert aciertos["por_debajo"]["por_encima"] == 1
    # El «por encima» ya superaba el cuartil el día de la lectura.
    assert aciertos["por_encima"]["por_encima"] == 1
    assert aciertos["por_encima"]["ya_superaba"] == 1
    assert aciertos["en_linea"]["en_linea"] == 1
