"""Cifras del análisis exploratorio que también enseña la aplicación.

El notebook 02_eda las calcula con estas funciones y `exportar` las guarda en
mercado.json, así que la portada de la app no repite cifras escritas a mano
que dejarían de ser ciertas al reentrenar con datos nuevos.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

MIN_RESENAS_PCT = 10  # con menos reseñas, el % de positivas es puro ruido
UMBRAL_POSITIVAS_BAJAS = 0.6
MIN_JUEGOS_GENERO = 15


def epsilon_cuadrado(h: float, n: int) -> float:
    """Tamaño del efecto de Kruskal-Wallis: fracción de la varianza de rangos explicada."""
    return h / (n - 1)


def spearman_lectura_mes(dataset: pd.DataFrame, dia: int = 7) -> float:
    """Correlación de rangos entre las reseñas del día de lectura y las del día 30."""
    return float(
        stats.spearmanr(dataset[f"resenas_{dia}d"], dataset["resenas_30d"]).statistic
    )


def residuos_7d(dataset: pd.DataFrame) -> pd.Series:
    """Lo que el volumen de la primera semana no explica del mes, en log.

    Recta de log(1 + reseñas a 30 días) sobre log(1 + reseñas a 7 días).
    """
    x = np.log1p(dataset["resenas_7d"])
    y = np.log1p(dataset["resenas_30d"])
    pendiente, corte = np.polyfit(x, y, 1)
    return y - (pendiente * x + corte)


def efecto_positivas_bajas(dataset: pd.DataFrame) -> dict[str, float]:
    """Cuánto acaban por debajo de lo esperado los juegos con pocas positivas.

    Mediana del residuo de los juegos con el 60 % o menos de positivas en su
    primera semana (y al menos 10 reseñas), y su lectura en porcentaje.
    """
    con_pct = dataset.assign(residuo=residuos_7d(dataset)).dropna(
        subset=["pct_positivas_7d"]
    )
    con_pct = con_pct[con_pct["resenas_7d"] >= MIN_RESENAS_PCT]
    bajas = con_pct[con_pct["pct_positivas_7d"] <= UMBRAL_POSITIVAS_BAJAS]
    residuo = float(bajas["residuo"].median())
    return {
        "juegos": len(bajas),
        "residuo_mediano_log": round(residuo, 3),
        "efecto": round(float(np.expm1(residuo)), 3),
    }


def efecto_precio_genero(dataset: pd.DataFrame) -> dict[str, float]:
    """ε² de Kruskal-Wallis de las reseñas a 30 días por banda de precio y por género."""
    frecuentes = (
        dataset["genero_principal"]
        .value_counts()
        .loc[lambda s: s >= MIN_JUEGOS_GENERO]
        .index
    )
    salida = {}
    for nombre, columna, datos in [
        ("precio", "banda_precio", dataset),
        (
            "genero",
            "genero_principal",
            dataset[dataset["genero_principal"].isin(frecuentes)],
        ),
    ]:
        grupos = [g["resenas_30d"] for _, g in datos.groupby(columna)]
        h, _ = stats.kruskal(*grupos)
        salida[nombre] = round(float(epsilon_cuadrado(h, len(datos))), 3)
    return salida


def hallazgos(dataset: pd.DataFrame) -> dict[str, Any]:
    """Las cifras del EDA que se enseñan en la portada de la aplicación."""
    return {
        "spearman_7_30": round(spearman_lectura_mes(dataset, 7), 2),
        "positivas_bajas": efecto_positivas_bajas(dataset),
        "epsilon2": efecto_precio_genero(dataset),
    }
