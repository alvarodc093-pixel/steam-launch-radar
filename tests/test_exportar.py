"""El JSON exportado reproduce las predicciones de scikit-learn.

`evaluar_json` hace a mano lo mismo que `app/src/lib/modelo.ts`; si este
test pasa y los casos dorados de la app pasan, Python, el JSON y la app
dicen lo mismo.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd
import pytest
from sklearn.base import clone

from radar import exportar
from radar import modelo as m
from radar.preparacion import SENALES


def _vector(js: dict, fila: dict) -> list[float]:
    valores = []
    for col in js["numericas"]:
        v = fila.get(col)
        if v is None or (isinstance(v, float) and math.isnan(v)):
            v = js["medianas"][col]
        if "medias" in js:
            v = (v - js["medias"][col]) / js["escalas"][col]
        valores.append(v)
    for col in js["categoricas"]:
        valores += [1.0 if fila[col] == c else 0.0 for c in js["categorias"][col]]
    return valores


def evaluar_json(js: dict, fila: dict) -> float:
    if js["tipo"] == "mediana":
        return js["mediana"]
    if js["tipo"] == "ratio_tipico":
        return fila[js["ratio"]["columna"]] + js["ratio"]["desplazamiento"]
    x = _vector(js, fila)
    if js["tipo"] == "ridge":
        return js["ridge"]["intercepto"] + sum(
            c * v for c, v in zip(js["ridge"]["coef"], x, strict=True)
        )
    total = js["gb"]["inicial"]
    for a in js["gb"]["arboles"]:
        nodo = 0
        while a["izq"][nodo] != -1:
            nodo = (
                a["izq"][nodo]
                if x[a["variable"][nodo]] <= a["umbral"][nodo]
                else a["der"][nodo]
            )
        total += js["gb"]["tasa"] * a["valor"][nodo]
    return total


@pytest.fixture
def datos() -> pd.DataFrame:
    rng = np.random.default_rng(3)
    n = 200
    r7 = rng.lognormal(3, 1, n).round()
    df = pd.DataFrame(
        {
            "appid": range(n),
            "fecha_lanzamiento": pd.date_range("2024-01-01", periods=n, freq="3D"),
            "precio_usd": rng.choice([0.0, 9.99, 19.99], n),
            "genero_principal": rng.choice(["Action", "RPG"], n),
            "mes_lanzamiento": rng.integers(1, 13, n),
            "resenas_7d": r7,
            "pct_positivas_7d": np.where(
                rng.uniform(size=n) < 0.1, np.nan, rng.uniform(0.4, 1, n)
            ),
            "resenas_30d": np.round(r7 * 2.5 * rng.lognormal(0, 0.3, n)),
        }
    )
    df["gratis"] = df["precio_usd"] == 0
    return df


@pytest.mark.parametrize(
    "tipo", ["mediana", "ratio_tipico", "ridge", "gradient_boosting"]
)
def test_json_reproduce_a_sklearn(datos, tipo) -> None:  # noqa: ANN001
    variables = m.variables_radar(7)
    res = m.entrenar(datos, variables, columna_ratio="log_resenas_7d")
    # Fuerza cada tipo de candidato para probar todas las ramas del JSON.
    train, _, test = m.particion_temporal(datos)
    tr = m.preparar_variables(train, res.generos)
    modelo = clone(m.candidatos(variables, "log_resenas_7d")[tipo])
    modelo.fit(tr[variables.todas], np.log1p(tr["resenas_30d"]))
    res.nombre, res.modelo = tipo, modelo

    js = json.loads(json.dumps(exportar._redondear(exportar.serializar(res), 12)))
    te = m.preparar_variables(test, res.generos)
    esperado = modelo.predict(te[variables.todas])
    obtenido = [
        evaluar_json(js, fila) for fila in te[variables.todas].to_dict("records")
    ]
    np.testing.assert_allclose(obtenido, esperado, atol=1e-6)


def test_entradas_app_coinciden_con_las_variables(datos) -> None:  # noqa: ANN001
    fila = exportar.entradas_app(datos.head(1), 7)[0]
    assert set(fila) == {
        "precio_usd",
        "genero",
        "mes_lanzamiento",
        "dia",
        "resenas",
        "pct_positivas",
        "senales",
    }
    # Sin señales medidas van vacías, no a cero: la app las imputa.
    assert set(fila["senales"]) == set(SENALES)
