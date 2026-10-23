"""Entrena los modelos y escribe los JSON que lee la aplicación (app/data).

Vercel no ejecuta Python, así que cada modelo se exporta como datos
(medianas de imputación, escalado, categorías y coeficientes o árboles) y
la app lo evalúa en TypeScript. `casos_dorados.json` guarda predicciones
hechas aquí para que los tests de la app comprueben que dan lo mismo.

Uso:
    python -m radar.exportar
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pandas as pd

from radar import config
from radar import modelo as m

logger = logging.getLogger("radar.exportar")

CUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9]
MIN_COHORTE = 20  # por debajo, la cohorte por género no es fiable y se usa la global


def _redondear(valor: Any, cifras: int = 6) -> Any:
    if isinstance(valor, float | np.floating):
        return None if np.isnan(valor) else round(float(valor), cifras)
    if isinstance(valor, np.integer):
        return int(valor)
    if isinstance(valor, dict):
        return {k: _redondear(v, cifras) for k, v in valor.items()}
    if isinstance(valor, list | tuple):
        return [_redondear(v, cifras) for v in valor]
    return valor


def _escribir(nombre: str, datos: dict[str, Any]) -> None:
    config.DIR_APP_DATOS.mkdir(parents=True, exist_ok=True)
    ruta = config.DIR_APP_DATOS / nombre
    ruta.write_text(
        json.dumps(_redondear(datos), ensure_ascii=False, indent=1), encoding="utf-8"
    )
    logger.info("Escrito %s (%.0f KB)", ruta.name, ruta.stat().st_size / 1024)


# --- serialización del modelo ----------------------------------------------


def serializar(res: m.Resultado) -> dict[str, Any]:
    """Describe el modelo elegido de forma que TypeScript pueda reproducirlo."""
    datos: dict[str, Any] = {
        "tipo": res.nombre,
        "numericas": res.variables.numericas,
        "categoricas": res.variables.categoricas,
        "generos": res.generos,
        "q90": res.q90,
        "metricas_test": res.test,
        "baselines_test": res.test_baselines,
        "cv_mae_log": res.cv.groupby("modelo")["mae_log"]
        .agg(["mean", "std"])
        .round(4)
        .to_dict("index"),
        "tamanos": res.tamanos,
    }
    modelo = res.modelo
    if res.nombre == "mediana":
        datos["mediana"] = modelo.valor_
        return datos
    if res.nombre == "ratio_cohorte":
        datos["ratio"] = {
            "columna": modelo.columna,
            "desplazamiento": modelo.desplazamiento_,
        }
        return datos

    pre = modelo.named_steps["pre"]
    num = pre.named_transformers_["num"]
    datos["medianas"] = dict(
        zip(
            res.variables.numericas, num.named_steps["imputar"].statistics_, strict=True
        )
    )
    if "escalar" in num.named_steps:
        esc = num.named_steps["escalar"]
        datos["medias"] = dict(zip(res.variables.numericas, esc.mean_, strict=True))
        datos["escalas"] = dict(zip(res.variables.numericas, esc.scale_, strict=True))
    if res.variables.categoricas:
        cat = pre.named_transformers_["cat"]
        datos["categorias"] = {
            col: [str(c) for c in cats]
            for col, cats in zip(
                res.variables.categoricas, cat.categories_, strict=True
            )
        }

    estimador = modelo.named_steps["modelo"]
    if res.nombre == "ridge":
        datos["ridge"] = {
            "coef": estimador.coef_.tolist(),
            "intercepto": estimador.intercept_,
        }
    else:
        datos["gb"] = {
            "inicial": float(estimador.init_.constant_.ravel()[0]),
            "tasa": estimador.learning_rate,
            "arboles": [
                {
                    "izq": a.tree_.children_left.tolist(),
                    "der": a.tree_.children_right.tolist(),
                    "variable": a.tree_.feature.tolist(),
                    "umbral": a.tree_.threshold.tolist(),
                    "valor": a.tree_.value[:, 0, 0].tolist(),
                }
                for a in estimador.estimators_.ravel()
            ],
        }
    return datos


# --- tablas de referencia ---------------------------------------------------


def _cuantiles(serie: pd.Series) -> list[float]:
    return [float(serie.quantile(q)) for q in CUANTILES]


def cohortes(train: pd.DataFrame) -> dict[str, Any]:
    """Distribución de reseñas por día de lectura, global y por género.

    Se calcula solo con el train, igual que el modelo: un juego del test no
    se compara contra una cohorte que lo incluye a él.
    """
    salida: dict[str, Any] = {"cuantiles": CUANTILES, "global": {}, "por_genero": {}}
    for k in (*config.DIAS_LECTURA, config.DIAS_VENTANA):
        salida["global"][str(k)] = _cuantiles(train[f"resenas_{k}d"])
    for genero, grupo in train.groupby("genero_principal"):
        if len(grupo) >= MIN_COHORTE:
            salida["por_genero"][genero] = {
                "n": len(grupo),
                **{
                    str(k): _cuantiles(grupo[f"resenas_{k}d"])
                    for k in (*config.DIAS_LECTURA, config.DIAS_VENTANA)
                },
            }
    salida["n_global"] = len(train)
    return salida


def curva_tipica(diarias: pd.DataFrame, appids: pd.Series) -> list[float]:
    """Mediana de la fracción acumulada de las reseñas a 30 días, día a día."""
    ventana = diarias[
        diarias["appid"].isin(appids)
        & diarias["dia"].between(0, config.DIAS_VENTANA - 1)
    ]
    tabla = ventana.pivot_table(
        index="appid", columns="dia", values="resenas", aggfunc="sum"
    )
    tabla = tabla.reindex(columns=range(config.DIAS_VENTANA), fill_value=0).fillna(0)
    acumulada = tabla.cumsum(axis=1)
    fraccion = acumulada.div(
        acumulada[config.DIAS_VENTANA - 1].replace(0, np.nan), axis=0
    )
    return fraccion.median().round(4).tolist()


def ejemplos(test: pd.DataFrame, diarias: pd.DataFrame) -> list[dict[str, Any]]:
    """Juegos del test (no vistos al entrenar) para probar el radar con datos reales."""
    filas = []
    for _, j in test.iterrows():
        dias = diarias[
            (diarias["appid"] == j["appid"])
            & diarias["dia"].between(0, config.DIAS_VENTANA - 1)
        ]
        serie = dias.set_index("dia")["resenas"].reindex(
            range(config.DIAS_VENTANA), fill_value=0
        )
        filas.append(
            {
                "appid": int(j["appid"]),
                "nombre": j["nombre"],
                "fecha_lanzamiento": j["fecha_lanzamiento"].date().isoformat(),
                "precio_usd": j["precio_usd"],
                "genero": j["genero_principal"],
                "lecturas": {
                    str(k): {
                        "resenas": int(j[f"resenas_{k}d"]),
                        "pct_positivas": j[f"pct_positivas_{k}d"],
                    }
                    for k in config.DIAS_LECTURA
                },
                "resenas_30d": int(j["resenas_30d"]),
                "acumuladas": serie.cumsum().astype(int).tolist(),
            }
        )
    return filas


def predecir_python(res: m.Resultado, entrada: pd.DataFrame) -> np.ndarray:
    x = m.preparar_variables(entrada, res.generos)[res.variables.todas]
    return res.modelo.predict(x)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    proc = config.DIR_PROCESADO
    dataset = pd.read_csv(proc / "dataset_radar.csv", parse_dates=["fecha_lanzamiento"])
    juegos = pd.read_csv(proc / "juegos.csv", parse_dates=["fecha_lanzamiento"])
    diarias = pd.read_csv(proc / "resenas_diarias.csv")

    train, _, test = m.particion_temporal(dataset)
    resultados = {
        k: m.entrenar(dataset, m.variables_radar(k), columna_ratio=f"log_resenas_{k}d")
        for k in config.DIAS_LECTURA
    }
    previo = m.entrenar(dataset, m.VARIABLES_PREVIAS)

    generado = datetime.now(UTC).isoformat(timespec="seconds")
    _escribir(
        "radar.json",
        {
            "generado_en": generado,
            "dias_lectura": list(config.DIAS_LECTURA),
            "modelos": {str(k): serializar(r) for k, r in resultados.items()},
            "cohortes": cohortes(train),
            "curva_tipica": {
                "global": curva_tipica(diarias, train["appid"]),
                **{
                    g: curva_tipica(diarias, grupo["appid"])
                    for g, grupo in train.groupby("genero_principal")
                    if len(grupo) >= MIN_COHORTE
                },
            },
            "ejemplos": ejemplos(test, diarias),
        },
    )
    _escribir(
        "previo.json",
        {"generado_en": generado, "modelo": serializar(previo), **benchmark(dataset)},
    )
    _escribir(
        "mercado.json",
        {"generado_en": generado, **resumen_mercado(juegos, dataset, diarias)},
    )

    casos = []
    for k, res in resultados.items():
        pred = predecir_python(res, test)
        casos += [
            {"modelo": f"radar_{k}", "entrada": fila, "esperado": float(p)}
            for fila, p in zip(entradas_app(test, k), pred, strict=True)
        ]
    pred_previo = predecir_python(previo, test)
    casos += [
        {"modelo": "previo", "entrada": fila, "esperado": float(p)}
        for fila, p in zip(entradas_app(test, None), pred_previo, strict=True)
    ]
    (config.RAIZ / "app" / "tests").mkdir(parents=True, exist_ok=True)
    (config.RAIZ / "app" / "tests" / "casos_dorados.json").write_text(
        json.dumps(_redondear(casos, 10), ensure_ascii=False), encoding="utf-8"
    )
    logger.info("Casos dorados: %d", len(casos))
    return 0


def entradas_app(df: pd.DataFrame, dia: int | None) -> list[dict[str, Any]]:
    """La misma entrada que manda el formulario de la app."""
    filas = []
    for _, j in df.iterrows():
        fila = {
            "precio_usd": float(j["precio_usd"]),
            "genero": j["genero_principal"],
            "mes_lanzamiento": int(j["mes_lanzamiento"]),
        }
        if dia is not None:
            pct = j[f"pct_positivas_{dia}d"]
            fila |= {
                "dia": dia,
                "resenas": int(j[f"resenas_{dia}d"]),
                "pct_positivas": None if pd.isna(pct) else float(pct),
            }
        filas.append(fila)
    return filas


def benchmark(dataset: pd.DataFrame) -> dict[str, Any]:
    """Reseñas a 30 días por género y banda de precio (toda la muestra apta)."""
    tabla = []
    for (genero, banda), grupo in dataset.groupby(["genero_principal", "banda_precio"]):
        tabla.append(
            {
                "genero": genero,
                "banda": banda,
                "n": len(grupo),
                "cuantiles": _cuantiles(grupo["resenas_30d"]),
            }
        )
    por_genero = [
        {"genero": g, "n": len(x), "cuantiles": _cuantiles(x["resenas_30d"])}
        for g, x in dataset.groupby("genero_principal")
    ]
    por_banda = [
        {"banda": b, "n": len(x), "cuantiles": _cuantiles(x["resenas_30d"])}
        for b, x in dataset.groupby("banda_precio")
    ]
    return {
        "cuantiles": CUANTILES,
        "global": {"n": len(dataset), "cuantiles": _cuantiles(dataset["resenas_30d"])},
        "por_genero": por_genero,
        "por_banda": por_banda,
        "genero_banda": tabla,
    }


def resumen_mercado(
    juegos: pd.DataFrame, dataset: pd.DataFrame, diarias: pd.DataFrame
) -> dict[str, Any]:
    """Indicadores del panel: tamaño de la muestra, exclusiones y ritmo de reseñas."""
    por_mes = dataset.groupby(dataset["fecha_lanzamiento"].dt.to_period("M")).agg(
        lanzamientos=("appid", "size"), mediana_30d=("resenas_30d", "median")
    )
    fraccion = {
        str(k): float((dataset[f"resenas_{k}d"] / dataset["resenas_30d"]).median())
        for k in config.DIAS_LECTURA
    }
    return {
        "juegos_descargados": len(juegos),
        "juegos_aptos": len(dataset),
        "exclusiones": juegos["estado"].value_counts().to_dict(),
        "rango_lanzamientos": {
            "desde": dataset["fecha_lanzamiento"].min().date().isoformat(),
            "hasta": dataset["fecha_lanzamiento"].max().date().isoformat(),
        },
        "mediana_resenas_30d": float(dataset["resenas_30d"].median()),
        "mediana_pct_positivas_7d": float(dataset["pct_positivas_7d"].median()),
        "fraccion_mediana_del_mes": fraccion,
        "por_mes": [
            {
                "mes": str(p),
                "lanzamientos": int(f["lanzamientos"]),
                "mediana_30d": float(f["mediana_30d"]),
            }
            for p, f in por_mes.iterrows()
        ],
        "por_genero": [
            {"genero": g, "n": len(x), "mediana_30d": float(x["resenas_30d"].median())}
            for g, x in dataset.groupby("genero_principal")
        ],
        "por_banda": [
            {"banda": b, "n": len(x), "mediana_30d": float(x["resenas_30d"].median())}
            for b, x in dataset.groupby("banda_precio")
        ],
        "curva_tipica": curva_tipica(diarias, dataset["appid"]),
    }


if __name__ == "__main__":
    raise SystemExit(main())
