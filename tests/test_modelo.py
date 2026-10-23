"""Partición, baselines, intervalo conformal y ausencia de fugas."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from radar import config
from radar import modelo as m


@pytest.fixture
def dataset() -> pd.DataFrame:
    """300 lanzamientos sintéticos: r30 ≈ 3 × r7 con ruido."""
    rng = np.random.default_rng(0)
    n = 300
    r7 = rng.lognormal(3, 1.2, n).round()
    df = pd.DataFrame(
        {
            "appid": range(n),
            "fecha_lanzamiento": pd.date_range("2024-01-01", periods=n, freq="2D"),
            "precio_usd": rng.choice([0.0, 4.99, 14.99, 29.99], n),
            "genero_principal": rng.choice(
                ["Action", "RPG", "Strategy", "Rara"], n, p=[0.4, 0.3, 0.29, 0.01]
            ),
            "mes_lanzamiento": rng.integers(1, 13, n),
            "resenas_7d": r7,
            "pct_positivas_7d": rng.uniform(0.5, 1, n),
            "resenas_30d": np.round(r7 * 3 * rng.lognormal(0, 0.2, n)),
        }
    )
    df["gratis"] = df["precio_usd"] == 0
    return df


def test_particion_cronologica_sin_solapes(dataset) -> None:  # noqa: ANN001
    train, calib, test = m.particion_temporal(dataset.sample(frac=1, random_state=1))
    assert len(train) + len(calib) + len(test) == len(dataset)
    assert train["fecha_lanzamiento"].max() <= calib["fecha_lanzamiento"].min()
    assert calib["fecha_lanzamiento"].max() <= test["fecha_lanzamiento"].min()


def test_variables_del_radar_no_miran_el_futuro() -> None:
    for dia in config.DIAS_LECTURA:
        nombres = m.variables_radar(dia).todas
        assert "resenas_30d" not in nombres and "log_resenas_30d" not in nombres
        posteriores = [d for d in config.DIAS_LECTURA if d > dia]
        assert not any(f"_{d}d" in v for v in nombres for d in posteriores)
    assert not any("resenas" in v for v in m.VARIABLES_PREVIAS.todas)


def test_ratio_cohorte_aprende_el_desplazamiento() -> None:
    x = pd.DataFrame({"log_r": np.log1p([10.0, 20.0, 40.0])})
    y = x["log_r"].to_numpy() + np.log(3)
    pred = m.RatioCohorte("log_r").fit(x, y).predict(x)
    np.testing.assert_allclose(pred, y)


def test_cuantil_conformal_con_correccion_de_muestra_finita() -> None:
    residuos = np.arange(1, 11, dtype=float)  # n = 10 → nivel ceil(11·0,9)/10 = 1
    assert m.cuantil_conformal(residuos, 0.9) == 10
    assert m.cuantil_conformal(np.arange(1, 101, dtype=float), 0.9) == 91


def test_entrenar_radar_supera_a_la_mediana_y_cubre(dataset) -> None:  # noqa: ANN001
    res = m.entrenar(dataset, m.variables_radar(7), columna_ratio="log_resenas_7d")
    assert res.nombre != "mediana"
    assert res.test["mae_log"] < res.test_baselines["mediana"]["mae_log"] / 2
    assert 0.7 <= res.test["cobertura_90"] <= 1.0
    assert res.tamanos == {"train": 180, "calibracion": 60, "test": 60}
    # los géneros raros del train se agrupan en «Otros»
    assert "Rara" not in res.generos or len(res.generos) <= m.GENEROS_MAX
