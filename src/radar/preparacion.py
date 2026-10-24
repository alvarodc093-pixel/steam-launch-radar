"""De la caché cruda (data/raw) a las tablas que usan notebooks, modelo y app.

Salidas en data/processed/ (se versionan: son agregados sin datos personales):
    juegos.csv            una fila por juego descargado, con su estado
    resenas_diarias.csv   reseñas por juego y día desde el lanzamiento (0-89)
    dataset_radar.csv     una fila por juego apto para el modelo

Uso:
    python -m radar.preparacion
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from radar import config

logger = logging.getLogger("radar.preparacion")

DIAS_GUARDADOS = 90
# Géneros que Steam añade casi a todo y que no describen el tipo de juego.
GENEROS_GENERICOS = {"Indie", "Early Access", "Free To Play", "Free to Play"}
# Más de este porcentaje de reseñas anteriores a la fecha oficial indica que
# el juego tuvo una fase pública previa (acceso anticipado, demo con
# reseñas): su «lanzamiento» no arranca de cero y el radar no aplica.
MAX_PCT_PREVIAS = 0.05

BANDAS = [
    ("gratis", 0.0),
    ("hasta_10", 10.0),
    ("hasta_20", 20.0),
    ("hasta_40", 40.0),
    ("mas_de_40", float("inf")),
]


def banda_precio(precio: float | None) -> str | None:
    if precio is None or pd.isna(precio):
        return None
    for nombre, tope in BANDAS:
        if precio <= tope:
            return nombre
    return None  # pragma: no cover - el último tope es infinito


def genero_principal(generos: list[str]) -> str:
    especificos = [g for g in generos if g not in GENEROS_GENERICOS]
    if especificos:
        return especificos[0]
    return "Casual" if not generos else generos[0]


def _leer_json(carpeta: Path) -> list[dict]:
    return [
        json.loads(r.read_text(encoding="utf-8"))
        for r in sorted(carpeta.glob("*.json"))
    ]


def construir_juegos(fichas: list[dict], resenas: list[dict]) -> pd.DataFrame:
    """Une ficha y resumen de reseñas; `estado` explica por qué entra o no."""
    por_app = {r["appid"]: r for r in resenas}
    filas = []
    for f in fichas:
        if f.get("descartada") or f["appid"] not in por_app:
            continue
        r = por_app[f["appid"]]
        generos = f.get("generos") or []
        filas.append(
            {
                "appid": f["appid"],
                "nombre": f.get("nombre"),
                "fecha_lanzamiento": f.get("fecha_lanzamiento"),
                "precio_usd": f.get("precio_usd"),
                "gratis": bool(f.get("gratis")),
                "genero_principal": genero_principal(generos),
                "generos": "|".join(generos),
                "es_indie": "Indie" in generos,
                "desarrollador": (f.get("desarrolladores") or [None])[0],
                "editor": (f.get("editores") or [None])[0],
                "resenas_api": r.get("total_api"),
                "resenas_descargadas": r.get("descargadas", 0),
                "descarga_completa": bool(r.get("completo")),
                "descargado_en": r.get("descargado_en"),
            }
        )
    juegos = pd.DataFrame(filas)
    juegos["fecha_lanzamiento"] = pd.to_datetime(juegos["fecha_lanzamiento"])
    juegos["banda_precio"] = juegos["precio_usd"].map(banda_precio)
    return juegos


def construir_diarias(resenas: list[dict], juegos: pd.DataFrame) -> pd.DataFrame:
    """Reseñas por día relativo al lanzamiento (negativo = antes de la fecha oficial)."""
    lanzamiento = juegos.set_index("appid")["fecha_lanzamiento"]
    filas = []
    for r in resenas:
        if r["appid"] not in lanzamiento.index:
            continue
        inicio = lanzamiento[r["appid"]]
        for fecha, (pos, neg) in r.get("dias", {}).items():
            dia = (pd.Timestamp(fecha) - inicio).days
            filas.append((r["appid"], dia, pos, neg))
    diarias = pd.DataFrame(filas, columns=["appid", "dia", "positivas", "negativas"])
    diarias["resenas"] = diarias["positivas"] + diarias["negativas"]
    return diarias.sort_values(["appid", "dia"]).reset_index(drop=True)


def marcar_aptos(juegos: pd.DataFrame, diarias: pd.DataFrame) -> pd.DataFrame:
    """Añade `pct_previas` y `estado` (apto o motivo de exclusión)."""
    totales = diarias.groupby("appid")["resenas"].sum()
    previas = diarias[diarias["dia"] < 0].groupby("appid")["resenas"].sum()
    en_30 = diarias[diarias["dia"].between(0, config.DIAS_VENTANA - 1)]
    r30 = en_30.groupby("appid")["resenas"].sum()

    juegos = juegos.copy()
    juegos["pct_previas"] = (
        (previas / totales).reindex(juegos["appid"]).fillna(0).to_numpy()
    )
    juegos["resenas_30d"] = (
        r30.reindex(juegos["appid"]).fillna(0).astype(int).to_numpy()
    )

    # La API solo sirve el último año de reseñas (ver ingesta/resenas.py): si
    # el lanzamiento queda antes, su primer mes está incompleto aunque la
    # paginación haya terminado bien.
    descarga = pd.to_datetime(juegos["descargado_en"], utc=True).dt.tz_localize(None)
    limite = descarga.dt.normalize() - pd.Timedelta(
        days=config.HISTORICO_API_DIAS - config.DIAS_MARGEN_INICIO
    )
    fuera = (juegos["fecha_lanzamiento"] < limite).fillna(False).to_numpy()

    estado = np.full(len(juegos), "apto", dtype=object)
    estado[juegos["pct_previas"] > MAX_PCT_PREVIAS] = "fase_previa_publica"
    estado[juegos["resenas_30d"] == 0] = "sin_resenas_en_30d"
    estado[juegos["precio_usd"].isna()] = "sin_precio_usd"
    estado[fuera] = "fuera_del_historico_api"
    estado[~juegos["descarga_completa"]] = "descarga_incompleta"
    juegos["estado"] = estado
    return juegos


def construir_dataset(juegos: pd.DataFrame, diarias: pd.DataFrame) -> pd.DataFrame:
    """Variables de lectura (días 3, 7, 14) y objetivo a 30 días por juego apto."""
    aptos = juegos[juegos["estado"] == "apto"].copy()
    ventana = diarias[diarias["appid"].isin(aptos["appid"]) & (diarias["dia"] >= 0)]
    for k in config.DIAS_LECTURA:
        tramo = (
            ventana[ventana["dia"] < k].groupby("appid")[["resenas", "positivas"]].sum()
        )
        tramo = tramo.reindex(aptos["appid"]).fillna(0)
        aptos[f"resenas_{k}d"] = tramo["resenas"].astype(int).to_numpy()
        # Sin reseñas todavía no hay positividad que medir: se deja vacía y
        # el modelo la imputa, en lugar de inventar un 0 % o un 100 %.
        aptos[f"pct_positivas_{k}d"] = np.where(
            tramo["resenas"] > 0,
            tramo["positivas"] / tramo["resenas"].replace(0, 1),
            np.nan,
        )
    aptos["mes_lanzamiento"] = aptos["fecha_lanzamiento"].dt.month
    aptos["dia_semana_lanzamiento"] = aptos["fecha_lanzamiento"].dt.day_of_week
    columnas = [
        "appid",
        "nombre",
        "fecha_lanzamiento",
        "precio_usd",
        "gratis",
        "banda_precio",
        "genero_principal",
        "es_indie",
        "mes_lanzamiento",
        "dia_semana_lanzamiento",
        *[
            c
            for k in config.DIAS_LECTURA
            for c in (f"resenas_{k}d", f"pct_positivas_{k}d")
        ],
        "resenas_30d",
    ]
    return aptos[columnas].sort_values("fecha_lanzamiento").reset_index(drop=True)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    # Solo los candidatos de la última búsqueda: la caché puede guardar fichas
    # de ejecuciones anteriores con otra ventana de fechas.
    vigentes = {
        c["appid"]
        for c in json.loads(
            (config.DIR_RAW / "candidatos.json").read_text(encoding="utf-8")
        )
    }
    fichas = [
        f for f in _leer_json(config.DIR_RAW / "fichas") if f["appid"] in vigentes
    ]
    resenas = [
        r for r in _leer_json(config.DIR_RAW / "resenas") if r["appid"] in vigentes
    ]
    juegos = construir_juegos(fichas, resenas)
    diarias = construir_diarias(resenas, juegos)
    juegos = marcar_aptos(juegos, diarias)
    dataset = construir_dataset(juegos, diarias)

    config.DIR_PROCESADO.mkdir(parents=True, exist_ok=True)
    juegos.to_csv(config.DIR_PROCESADO / "juegos.csv", index=False)
    diarias[diarias["dia"].between(-30, DIAS_GUARDADOS - 1)].to_csv(
        config.DIR_PROCESADO / "resenas_diarias.csv", index=False
    )
    dataset.to_csv(config.DIR_PROCESADO / "dataset_radar.csv", index=False)
    logger.info(
        "Juegos: %d (%s)", len(juegos), juegos["estado"].value_counts().to_dict()
    )
    logger.info("Dataset del radar: %d juegos aptos", len(dataset))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
