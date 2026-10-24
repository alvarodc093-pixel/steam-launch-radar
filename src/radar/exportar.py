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
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from radar import config
from radar import modelo as m

logger = logging.getLogger("radar.exportar")

CUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9]
MIN_COHORTE = 20  # por debajo, la cohorte por género no es fiable y se usa la global
RUTA_CASOS_DORADOS = config.RAIZ / "app" / "tests" / "casos_dorados.json"
DIAS_CON_OBJETIVO = (*config.DIAS_LECTURA, config.DIAS_VENTANA)


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


def _escribir(
    ruta: Path, contenido: Any, cifras: int = 6, indent: int | None = 1
) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    texto = json.dumps(_redondear(contenido, cifras), ensure_ascii=False, indent=indent)
    ruta.write_text(texto, encoding="utf-8")
    logger.info("Escrito %s (%.0f KB)", ruta.name, ruta.stat().st_size / 1024)


def _cuantiles(serie: pd.Series) -> list[float]:
    return [float(serie.quantile(q)) for q in CUANTILES]


# --- serialización del modelo ----------------------------------------------


def serializar(res: m.Resultado) -> dict[str, Any]:
    """Describe el modelo elegido de forma que TypeScript pueda reproducirlo."""
    descripcion: dict[str, Any] = {
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
        descripcion["mediana"] = modelo.valor_
        return descripcion
    if res.nombre == "ratio_tipico":
        descripcion["ratio"] = {
            "columna": modelo.columna,
            "desplazamiento": modelo.desplazamiento_,
        }
        return descripcion

    pre = modelo.named_steps["pre"]
    num = pre.named_transformers_["num"]
    numericas = res.variables.numericas
    descripcion["medianas"] = dict(
        zip(numericas, num.named_steps["imputar"].statistics_, strict=True)
    )
    if "escalar" in num.named_steps:
        escalador = num.named_steps["escalar"]
        descripcion["medias"] = dict(zip(numericas, escalador.mean_, strict=True))
        descripcion["escalas"] = dict(zip(numericas, escalador.scale_, strict=True))
    if res.variables.categoricas:
        codificador = pre.named_transformers_["cat"]
        descripcion["categorias"] = {
            col: [str(c) for c in cats]
            for col, cats in zip(
                res.variables.categoricas, codificador.categories_, strict=True
            )
        }

    estimador = modelo.named_steps["modelo"]
    if res.nombre == "ridge":
        descripcion["ridge"] = {
            "coef": estimador.coef_.tolist(),
            "intercepto": estimador.intercept_,
        }
    else:
        descripcion["gb"] = {
            "inicial": float(estimador.init_.constant_.ravel()[0]),
            "tasa": estimador.learning_rate,
            "arboles": [
                {
                    "izq": arbol.tree_.children_left.tolist(),
                    "der": arbol.tree_.children_right.tolist(),
                    "variable": arbol.tree_.feature.tolist(),
                    "umbral": arbol.tree_.threshold.tolist(),
                    "valor": arbol.tree_.value[:, 0, 0].tolist(),
                }
                for arbol in estimador.estimators_.ravel()
            ],
        }
    return descripcion


# --- tablas de referencia ---------------------------------------------------


def cohortes(train: pd.DataFrame) -> dict[str, Any]:
    """Distribución de reseñas por día de lectura, global y por género.

    Se calcula solo con el train, igual que el modelo: un juego del test no
    se compara contra una cohorte que lo incluye a él.
    """
    salida: dict[str, Any] = {
        "cuantiles": CUANTILES,
        "n_global": len(train),
        "global": {
            str(k): _cuantiles(train[f"resenas_{k}d"]) for k in DIAS_CON_OBJETIVO
        },
        "por_genero": {},
    }
    for genero, grupo in train.groupby("genero_principal"):
        if len(grupo) >= MIN_COHORTE:
            salida["por_genero"][genero] = {
                "n": len(grupo),
                **{
                    str(k): _cuantiles(grupo[f"resenas_{k}d"])
                    for k in DIAS_CON_OBJETIVO
                },
            }
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
    ventana = diarias[diarias["dia"].between(0, config.DIAS_VENTANA - 1)]
    resenas_por_dia = ventana.pivot_table(
        index="appid", columns="dia", values="resenas", aggfunc="sum"
    ).reindex(columns=range(config.DIAS_VENTANA), fill_value=0)
    filas = []
    for _, juego in test.iterrows():
        if juego["appid"] in resenas_por_dia.index:
            diario = resenas_por_dia.loc[juego["appid"]].fillna(0)
        else:
            diario = pd.Series(0, index=range(config.DIAS_VENTANA))
        filas.append(
            {
                "appid": int(juego["appid"]),
                "nombre": juego["nombre"],
                "fecha_lanzamiento": juego["fecha_lanzamiento"].date().isoformat(),
                "precio_usd": juego["precio_usd"],
                "genero": juego["genero_principal"],
                "lecturas": {
                    str(k): {
                        "resenas": int(juego[f"resenas_{k}d"]),
                        "pct_positivas": juego[f"pct_positivas_{k}d"],
                    }
                    for k in config.DIAS_LECTURA
                },
                "resenas_30d": int(juego["resenas_30d"]),
                "acumuladas": diario.cumsum().astype(int).tolist(),
            }
        )
    return filas


def benchmark(dataset: pd.DataFrame) -> dict[str, Any]:
    """Reseñas a 30 días por género y banda de precio (toda la muestra apta)."""

    def resumen(grupo: pd.DataFrame) -> dict[str, Any]:
        return {"n": len(grupo), "cuantiles": _cuantiles(grupo["resenas_30d"])}

    return {
        "cuantiles": CUANTILES,
        "global": resumen(dataset),
        "por_genero": [
            {"genero": g, **resumen(x)} for g, x in dataset.groupby("genero_principal")
        ],
        "por_banda": [
            {"banda": b, **resumen(x)} for b, x in dataset.groupby("banda_precio")
        ],
        "genero_banda": [
            {"genero": g, "banda": b, **resumen(x)}
            for (g, b), x in dataset.groupby(["genero_principal", "banda_precio"])
        ],
    }


def resumen_mercado(
    juegos: pd.DataFrame, dataset: pd.DataFrame, diarias: pd.DataFrame
) -> dict[str, Any]:
    """Indicadores del panel: tamaño de la muestra, exclusiones y ritmo de reseñas."""
    por_mes = dataset.groupby(dataset["fecha_lanzamiento"].dt.to_period("M")).agg(
        lanzamientos=("appid", "size"), mediana_30d=("resenas_30d", "median")
    )
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
        "fraccion_mediana_del_mes": {
            str(k): float((dataset[f"resenas_{k}d"] / dataset["resenas_30d"]).median())
            for k in config.DIAS_LECTURA
        },
        "por_mes": [
            {
                "mes": str(periodo),
                "lanzamientos": int(fila["lanzamientos"]),
                "mediana_30d": float(fila["mediana_30d"]),
            }
            for periodo, fila in por_mes.iterrows()
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


# --- casos dorados para los tests de la app ---------------------------------


def predecir_python(res: m.Resultado, entrada: pd.DataFrame) -> np.ndarray:
    x = m.preparar_variables(entrada, res.generos)[res.variables.todas]
    return res.modelo.predict(x)


def entradas_app(df: pd.DataFrame, dia: int | None) -> list[dict[str, Any]]:
    """La misma entrada que manda el formulario de la app."""
    filas = []
    for _, juego in df.iterrows():
        fila = {
            "precio_usd": float(juego["precio_usd"]),
            "genero": juego["genero_principal"],
            "mes_lanzamiento": int(juego["mes_lanzamiento"]),
        }
        if dia is not None:
            pct = juego[f"pct_positivas_{dia}d"]
            fila |= {
                "dia": dia,
                "resenas": int(juego[f"resenas_{dia}d"]),
                "pct_positivas": None if pd.isna(pct) else float(pct),
            }
        filas.append(fila)
    return filas


def casos_dorados(
    radar: dict[int, m.Resultado], previo: m.Resultado, test: pd.DataFrame
) -> list[dict[str, Any]]:
    casos = []
    for dia, res in radar.items():
        casos += [
            {"modelo": f"radar_{dia}", "entrada": fila, "esperado": float(pred)}
            for fila, pred in zip(
                entradas_app(test, dia), predecir_python(res, test), strict=True
            )
        ]
    casos += [
        {"modelo": "previo", "entrada": fila, "esperado": float(pred)}
        for fila, pred in zip(
            entradas_app(test, None), predecir_python(previo, test), strict=True
        )
    ]
    return casos


# --- orquestación -----------------------------------------------------------


def cargar_procesados(
    carpeta: Path,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    rutas = {
        nombre: carpeta / f"{nombre}.csv"
        for nombre in ("dataset_radar", "juegos", "resenas_diarias")
    }
    faltan = [str(r) for r in rutas.values() if not r.exists()]
    if faltan:
        raise FileNotFoundError(
            f"Faltan {', '.join(faltan)}: ejecuta antes python -m radar.preparacion."
        )
    dataset = pd.read_csv(rutas["dataset_radar"], parse_dates=["fecha_lanzamiento"])
    juegos = pd.read_csv(rutas["juegos"], parse_dates=["fecha_lanzamiento"])
    diarias = pd.read_csv(rutas["resenas_diarias"])
    return dataset, juegos, diarias


def exportar(carpeta_procesados: Path, carpeta_salida: Path, ruta_casos: Path) -> int:
    """Entrena, escribe los tres JSON de la app y los casos dorados; devuelve cuántos."""
    dataset, juegos, diarias = cargar_procesados(carpeta_procesados)
    train, _, test = m.particion_temporal(dataset)

    radar = {
        dia: m.entrenar(
            dataset, m.variables_radar(dia), columna_ratio=f"log_resenas_{dia}d"
        )
        for dia in config.DIAS_LECTURA
    }
    previo = m.entrenar(dataset, m.VARIABLES_PREVIAS)
    generado = datetime.now(UTC).isoformat(timespec="seconds")
    curvas = {"global": curva_tipica(diarias, train["appid"])}
    for genero, grupo in train.groupby("genero_principal"):
        if len(grupo) >= MIN_COHORTE:
            curvas[genero] = curva_tipica(diarias, grupo["appid"])

    _escribir(
        carpeta_salida / "radar.json",
        {
            "generado_en": generado,
            "dias_lectura": list(config.DIAS_LECTURA),
            "modelos": {str(dia): serializar(res) for dia, res in radar.items()},
            "cohortes": cohortes(train),
            "curva_tipica": curvas,
            "ejemplos": ejemplos(test, diarias),
        },
    )
    _escribir(
        carpeta_salida / "previo.json",
        {"generado_en": generado, "modelo": serializar(previo), **benchmark(dataset)},
    )
    _escribir(
        carpeta_salida / "mercado.json",
        {"generado_en": generado, **resumen_mercado(juegos, dataset, diarias)},
    )
    casos = casos_dorados(radar, previo, test)
    _escribir(ruta_casos, casos, cifras=10, indent=None)
    return len(casos)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        n = exportar(config.DIR_PROCESADO, config.DIR_APP_DATOS, RUTA_CASOS_DORADOS)
    except FileNotFoundError as exc:
        logger.error("%s", exc)
        return 1
    logger.info("Casos dorados: %d", n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
