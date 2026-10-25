"""Contraste de las reseñas con las ventas que anunciaron los propios estudios.

Steam no publica ventas, así que el proyecto predice reseñas. Para comprobar
que es una buena aproximación, `data/external/ventas_anunciadas.csv` recoge
las cifras oficiales de juegos de la muestra (con su fuente), y aquí se
cruzan con las reseñas en inglés que llevaba cada juego en la misma fecha.

Las copias por reseña solo se comparan limpiamente cuando la cifra es de PC:
las ventas en consola no dejan reseñas en Steam. Por eso cada anuncio indica
qué parte de sus unidades son de PC, si se conoce.

Uso:
    python -m radar.ventas
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from radar import config

logger = logging.getLogger("radar.ventas")

RUTA_VENTAS = config.RAIZ / "data" / "external" / "ventas_anunciadas.csv"
RUTA_SALIDA = config.DIR_APP_DATOS / "ventas.json"


def cargar_ventas(ruta: Path = RUTA_VENTAS) -> pd.DataFrame:
    return pd.read_csv(ruta, parse_dates=["fecha_dato"])


def contrastar(
    ventas: pd.DataFrame, juegos: pd.DataFrame, diarias: pd.DataFrame
) -> pd.DataFrame:
    """Reseñas en inglés a la fecha de cada anuncio y copias por reseña.

    `dia` son los días completos transcurridos desde el lanzamiento: una cifra
    de «la primera semana» se compara con las reseñas de los días 0 a 6, igual
    que la lectura del día 7 del radar.
    """
    lanzamientos = pd.to_datetime(juegos.set_index("appid")["fecha_lanzamiento"])
    filas = []
    for v in ventas.itertuples():
        dia = int((v.fecha_dato - lanzamientos[v.appid]).days)
        de_juego = diarias[(diarias["appid"] == v.appid) & (diarias["dia"] >= 0)]
        resenas = int(de_juego.loc[de_juego["dia"] < dia, "resenas"].sum())
        unidades_pc = v.unidades * v.cuota_pc if pd.notna(v.cuota_pc) else np.nan
        filas.append(
            {
                "appid": v.appid,
                "nombre": v.nombre,
                "dia": dia,
                "fecha_aproximada": bool(v.fecha_aproximada),
                "unidades": int(v.unidades),
                "plataformas": v.plataformas,
                "resenas_ingles": resenas,
                "copias_por_resena": round(v.unidades / resenas, 1),
                "copias_pc_por_resena": round(unidades_pc / resenas, 1)
                if pd.notna(unidades_pc)
                else None,
                "fuente": v.fuente,
                "url": v.url,
            }
        )
    return pd.DataFrame(filas)


DIAS_LANZAMIENTO = 14  # hasta aquí, la cifra es «del lanzamiento»


def resumen(contraste: pd.DataFrame) -> dict[str, Any]:
    """Copias de PC por reseña al lanzamiento y pasado el primer mes.

    Se separan porque no son comparables: al estrenarse muchos compran y aún no
    han jugado lo suficiente para reseñar, así que la proporción baja a medida
    que las reseñas alcanzan a las ventas.
    """
    pc = contraste.dropna(subset=["copias_pc_por_resena"])

    def tramo(filas: pd.DataFrame) -> dict[str, Any]:
        valores = filas["copias_pc_por_resena"]
        return {
            "juegos": len(filas),
            "mediana": round(float(valores.median()), 1),
            "minimo": round(float(valores.min()), 1),
            "maximo": round(float(valores.max()), 1),
        }

    return {
        "juegos": len(contraste),
        "con_cifra_de_pc": len(pc),
        "lanzamiento": tramo(pc[pc["dia"] <= DIAS_LANZAMIENTO]),
        "despues_del_primer_mes": tramo(pc[pc["dia"] > 30]),
    }


def _miles(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def tabla_markdown(contraste: pd.DataFrame) -> str:
    lineas = [
        "| Juego | Día | Copias anunciadas | Plataformas | Reseñas en inglés | Copias de PC por reseña |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for f in contraste.sort_values("dia").itertuples():
        dia = f"~{f.dia}" if f.fecha_aproximada else str(f.dia)
        sin_pc = f.copias_pc_por_resena is None or pd.isna(f.copias_pc_por_resena)
        pc = "—" if sin_pc else f"{f.copias_pc_por_resena:.0f}"
        lineas.append(
            f"| [{f.nombre}]({f.url}) | {dia} | {_miles(f.unidades)} | {f.plataformas} | "
            f"{_miles(f.resenas_ingles)} | {pc} |"
        )
    return "\n".join(lineas)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    juegos = pd.read_csv(config.DIR_PROCESADO / "juegos.csv")
    diarias = pd.read_csv(config.DIR_PROCESADO / "resenas_diarias.csv")
    contraste = contrastar(cargar_ventas(), juegos, diarias)
    # NaN no es JSON válido: los juegos sin cifra de PC llevan null.
    juegos_json = contraste.astype(object).where(contraste.notna(), None)
    datos = {"resumen": resumen(contraste), "juegos": juegos_json.to_dict("records")}
    RUTA_SALIDA.write_text(
        json.dumps(datos, ensure_ascii=False, indent=1, allow_nan=False),
        encoding="utf-8",
    )
    logger.info("Escrito %s", RUTA_SALIDA.name)
    print(tabla_markdown(contraste))
    print(datos["resumen"])


if __name__ == "__main__":
    main()
