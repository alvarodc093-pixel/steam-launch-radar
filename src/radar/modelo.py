"""Modelos del radar y del contexto previo al lanzamiento.

Las dos preguntas comparten método:
    1. Partición cronológica por fecha de lanzamiento: train (60 %),
       calibración (20 %) y test (20 %, los lanzamientos más recientes).
    2. El candidato se elige con validación cruzada temporal dentro del
       train; el test solo se usa una vez, para el informe final.
    3. El intervalo del 90 % es conformal: cuantil de los errores absolutos
       en el bloque de calibración, que el modelo no ha visto.

El objetivo es siempre log1p(reseñas en 30 días): el volumen tiene una cola
muy larga y en escala logarítmica el error es relativo («me equivoco un
factor x»), que es lo que le importa a un estudio pequeño.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.base import BaseEstimator, RegressorMixin, clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

FRACCION_CALIB = 0.2
FRACCION_TEST = 0.2
CONFIANZA = 0.9
PLIEGUES_CV = 4
SEMILLA = 42
GENEROS_MAX = 8  # el resto se agrupa en «Otros» para no tener columnas de 3 juegos


@dataclass
class Variables:
    numericas: list[str]
    categoricas: list[str] = field(default_factory=list)

    @property
    def todas(self) -> list[str]:
        return self.numericas + self.categoricas


def variables_radar(dia: int) -> Variables:
    """Lo que se sabe el día `dia` tras el lanzamiento (nada posterior)."""
    return Variables(
        numericas=[
            f"log_resenas_{dia}d",
            f"pct_positivas_{dia}d",
            "log_precio",
            "gratis",
        ],
        categoricas=["genero"],
    )


VARIABLES_PREVIAS = Variables(
    numericas=["log_precio", "gratis", "mes_lanzamiento"],
    categoricas=["genero"],
)


def preparar_variables(
    df: pd.DataFrame, generos: list[str] | None = None
) -> pd.DataFrame:
    """Transformaciones fijas (no aprenden nada de los datos salvo `generos`)."""
    out = df.copy()
    for col in [c for c in df.columns if c.startswith("resenas_") and c.endswith("d")]:
        out[f"log_{col}"] = np.log1p(out[col])
    out["log_precio"] = np.log1p(out["precio_usd"].astype(float))
    # Del precio y no de `is_free`: la app solo conoce el precio que escribe
    # el usuario, y ambas cosas coinciden en la muestra.
    out["gratis"] = (out["precio_usd"] == 0).astype(float)
    if generos is not None:
        out["genero"] = out["genero_principal"].where(
            out["genero_principal"].isin(generos), "Otros"
        )
    return out


def generos_frecuentes(train: pd.DataFrame) -> list[str]:
    """Los géneros más comunes del train; se fijan antes de ver calibración y test."""
    return train["genero_principal"].value_counts().head(GENEROS_MAX).index.tolist()


def particion_temporal(
    df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    ordenado = df.sort_values("fecha_lanzamiento").reset_index(drop=True)
    n = len(ordenado)
    fin_train = int(n * (1 - FRACCION_CALIB - FRACCION_TEST))
    fin_calib = int(n * (1 - FRACCION_TEST))
    return (
        ordenado.iloc[:fin_train],
        ordenado.iloc[fin_train:fin_calib],
        ordenado.iloc[fin_calib:],
    )


# --- candidatos -------------------------------------------------------------


class Mediana(BaseEstimator, RegressorMixin):
    """Baseline sin información: predice la mediana del train."""

    def fit(self, x: pd.DataFrame, y: np.ndarray) -> Mediana:
        self.valor_ = float(np.median(y))
        return self

    def predict(self, x: pd.DataFrame) -> np.ndarray:
        return np.full(len(x), self.valor_)


class RatioTipico(BaseEstimator, RegressorMixin):
    """Baseline del radar: reseñas a 30 días = reseñas al día k × ratio típico.

    Es la regla que aplicaría alguien con una hoja de cálculo: «a la semana
    un juego suele llevar el X % de lo que tendrá al mes». El ratio es uno
    solo para toda la muestra de entrenamiento (en log, la mediana de
    log1p(r30) − log1p(rk)); no distingue géneros ni precios.
    """

    def __init__(self, columna: str) -> None:
        self.columna = columna

    def fit(self, x: pd.DataFrame, y: np.ndarray) -> RatioTipico:
        self.desplazamiento_ = float(
            np.median(np.asarray(y) - x[self.columna].to_numpy())
        )
        return self

    def predict(self, x: pd.DataFrame) -> np.ndarray:
        return x[self.columna].to_numpy() + self.desplazamiento_


def _preproceso(variables: Variables, escalar: bool) -> ColumnTransformer:
    pasos_num: list[tuple[str, Any]] = [("imputar", SimpleImputer(strategy="median"))]
    if escalar:
        pasos_num.append(("escalar", StandardScaler()))
    transformadores = [("num", Pipeline(pasos_num), variables.numericas)]
    if variables.categoricas:
        transformadores.append(
            (
                "cat",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                variables.categoricas,
            )
        )
    return ColumnTransformer(transformadores)


def candidatos(
    variables: Variables, columna_ratio: str | None
) -> dict[str, BaseEstimator]:
    modelos: dict[str, BaseEstimator] = {"mediana": Mediana()}
    if columna_ratio:
        modelos["ratio_tipico"] = RatioTipico(columna_ratio)
    modelos["ridge"] = Pipeline(
        [("pre", _preproceso(variables, escalar=True)), ("modelo", Ridge(alpha=1.0))]
    )
    modelos["gradient_boosting"] = Pipeline(
        [
            ("pre", _preproceso(variables, escalar=False)),
            (
                "modelo",
                GradientBoostingRegressor(
                    n_estimators=200,
                    max_depth=2,
                    learning_rate=0.05,
                    random_state=SEMILLA,
                ),
            ),
        ]
    )
    return modelos


# --- evaluación -------------------------------------------------------------


def metricas(y_real: np.ndarray, y_pred: np.ndarray) -> dict[str, float | None]:
    """Errores en log1p y su lectura en reseñas (factor de error típico)."""
    y_real, y_pred = np.asarray(y_real), np.asarray(y_pred)
    error_abs = np.abs(y_real - y_pred)
    return {
        "mae_log": round(float(error_abs.mean()), 4),
        "mediana_error_log": round(float(np.median(error_abs)), 4),
        # exp(mediana del error en log): «en el juego típico la predicción
        # se desvía un factor x del valor real».
        "factor_error_tipico": round(float(np.exp(np.median(error_abs))), 3),
        # Un baseline constante no ordena nada: su correlación no existe.
        "spearman": None
        if np.ptp(y_pred) == 0
        else round(float(spearmanr(y_real, y_pred).statistic), 4),
        "dentro_de_x2": round(float((error_abs <= np.log(2)).mean()), 4),
    }


def validacion_cruzada(
    modelos: dict[str, BaseEstimator], x: pd.DataFrame, y: np.ndarray
) -> pd.DataFrame:
    """MAE en log por pliegue temporal (cada pliegue predice lanzamientos posteriores)."""
    filas = []
    for pliegue, (i_tr, i_va) in enumerate(TimeSeriesSplit(PLIEGUES_CV).split(x)):
        for nombre, modelo in modelos.items():
            ajustado = clone(modelo).fit(x.iloc[i_tr], y[i_tr])
            mae = mean_absolute_error(y[i_va], ajustado.predict(x.iloc[i_va]))
            filas.append({"pliegue": pliegue, "modelo": nombre, "mae_log": mae})
    return pd.DataFrame(filas)


def cuantil_conformal(residuos: np.ndarray, confianza: float = CONFIANZA) -> float:
    """k-ésimo error absoluto más pequeño, con k = ⌈(n + 1)·confianza⌉.

    Es la corrección de muestra finita del conformal partido: garantiza la
    cobertura pedida aunque el bloque de calibración sea pequeño.
    """
    ordenados = np.sort(np.abs(residuos))
    k = min(len(ordenados), int(np.ceil((len(ordenados) + 1) * confianza)))
    return float(ordenados[k - 1])


@dataclass
class Resultado:
    nombre: str
    modelo: BaseEstimator
    variables: Variables
    generos: list[str]
    cv: pd.DataFrame
    q90: float
    test: dict[str, Any]
    test_baselines: dict[str, dict[str, float | None]]
    tamanos: dict[str, int]


def entrenar(
    df: pd.DataFrame, variables: Variables, columna_ratio: str | None = None
) -> Resultado:
    """Elige por CV temporal, calibra el intervalo y evalúa una vez en test."""
    train, calib, test = particion_temporal(df)
    generos = generos_frecuentes(train)
    train, calib, test = (preparar_variables(p, generos) for p in (train, calib, test))
    objetivo = "resenas_30d"
    y_tr, y_ca, y_te = (
        np.log1p(p[objetivo].to_numpy(float)) for p in (train, calib, test)
    )
    x_tr, x_ca, x_te = (p[variables.todas] for p in (train, calib, test))

    modelos = candidatos(variables, columna_ratio)
    cv = validacion_cruzada(modelos, x_tr, y_tr)
    nombre = cv.groupby("modelo")["mae_log"].mean().idxmin()

    ajustados = {n: clone(m).fit(x_tr, y_tr) for n, m in modelos.items()}
    elegido = ajustados[nombre]
    q90 = cuantil_conformal(y_ca - elegido.predict(x_ca))

    pred_te = elegido.predict(x_te)
    test_m = metricas(y_te, pred_te)
    test_m["cobertura_90"] = round(float((np.abs(y_te - pred_te) <= q90).mean()), 4)
    return Resultado(
        nombre=nombre,
        modelo=elegido,
        variables=variables,
        generos=generos,
        cv=cv,
        q90=q90,
        test=test_m,
        test_baselines={
            n: metricas(y_te, m.predict(x_te))
            for n, m in ajustados.items()
            if n != nombre
        },
        tamanos={"train": len(train), "calibracion": len(calib), "test": len(test)},
    )
