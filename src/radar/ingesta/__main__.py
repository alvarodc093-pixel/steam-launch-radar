"""Ingesta reanudable: candidatos (buscador de la tienda) → fichas → reseñas.

Uso:
    python -m radar.ingesta                 # los tres pasos
    python -m radar.ingesta --paso resenas  # solo uno

Cada respuesta se guarda en data/raw/ en cuanto llega. Si la ejecución se
corta, al relanzarla se salta lo que ya está descargado.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from radar import config
from radar.ingesta import busqueda, resenas, tienda
from radar.ingesta.http import ClienteHttp, ErrorFuente

logger = logging.getLogger("radar.ingesta")

DIR_BUSQUEDA = config.DIR_RAW / "busqueda"
DIR_FICHAS = config.DIR_RAW / "fichas"
DIR_RESENAS = config.DIR_RAW / "resenas"


def _leer(ruta: Path) -> Any:
    return json.loads(ruta.read_text(encoding="utf-8"))


def _guardar(ruta: Path, datos: Any) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, default=str), encoding="utf-8")
    tmp.replace(ruta)  # escritura atómica: un corte no deja JSON a medias


def paso_candidatos(hoy: date) -> list[dict[str, Any]]:
    """Recorre el buscador desde hoy hacia atrás hasta salir de la ventana."""
    cliente = ClienteHttp(pausa_s=busqueda.PAUSA_S)
    desde, hasta = config.ventana_lanzamientos(hoy)
    candidatos: dict[int, dict[str, Any]] = {}
    inicio = 0
    while True:
        ruta = DIR_BUSQUEDA / f"desde_{inicio:06d}.json"
        if not ruta.exists():
            _guardar(ruta, busqueda.descargar_pagina(cliente, inicio))
        filas = _leer(ruta)
        for fila in filas:
            fila["fecha"] = (
                date.fromisoformat(fila["fecha"]) if fila.get("fecha") else None
            )
            if busqueda.es_candidato(
                fila, desde, hasta, config.RESENAS_MIN, config.RESENAS_MAX
            ):
                candidatos.setdefault(fila["appid"], fila)
        fechas = [f["fecha"] for f in filas if f["fecha"]]
        if not filas or (fechas and max(fechas) < desde):
            break
        inicio += busqueda.POR_PAGINA
        if inicio % 2000 == 0:
            logger.info(
                "Buscador: %d resultados recorridos, %d candidatos",
                inicio,
                len(candidatos),
            )
    lista = sorted(candidatos.values(), key=lambda c: c["appid"])
    _guardar(config.DIR_RAW / "candidatos.json", lista)
    logger.info("%d candidatos lanzados entre %s y %s", len(lista), desde, hasta)
    return lista


def paso_fichas(candidatos: list[dict[str, Any]]) -> None:
    cliente = ClienteHttp(pausa_s=tienda.PAUSA_S)
    pendientes = [
        c for c in candidatos if not (DIR_FICHAS / f"{c['appid']}.json").exists()
    ]
    logger.info("Fichas: %d pendientes de %d", len(pendientes), len(candidatos))
    for i, c in enumerate(pendientes, 1):
        try:
            ficha = tienda.descargar_ficha(cliente, c["appid"])
        except ErrorFuente as exc:
            logger.warning("Ficha %s sin descargar: %s", c["appid"], exc)
            continue
        # Se guarda también el «no es un juego» para no volver a pedirlo.
        _guardar(
            DIR_FICHAS / f"{c['appid']}.json",
            ficha or {"appid": c["appid"], "descartada": True},
        )
        if i % 100 == 0:
            logger.info("Fichas: %d/%d", i, len(pendientes))


def en_ventana(ficha: dict[str, Any], hoy: date) -> bool:
    fecha = ficha.get("fecha_lanzamiento")
    if ficha.get("descartada") or ficha.get("proximamente") or not fecha:
        return False
    desde, hasta = config.ventana_lanzamientos(hoy)
    return desde <= date.fromisoformat(str(fecha)) <= hasta


def paso_resenas(hoy: date) -> None:
    cliente = ClienteHttp(pausa_s=resenas.PAUSA_S)
    fichas = [_leer(r) for r in sorted(DIR_FICHAS.glob("*.json"))]
    elegibles = [f for f in fichas if en_ventana(f, hoy)]
    pendientes = [
        f for f in elegibles if not (DIR_RESENAS / f"{f['appid']}.json").exists()
    ]
    logger.info(
        "Reseñas: %d pendientes de %d juegos en ventana",
        len(pendientes),
        len(elegibles),
    )
    for i, f in enumerate(pendientes, 1):
        try:
            agregado = resenas.descargar_resenas(
                cliente, f["appid"], config.RESENAS_MAX
            )
        except ErrorFuente as exc:
            logger.warning("Reseñas %s sin descargar: %s", f["appid"], exc)
            continue
        agregado["appid"] = f["appid"]
        agregado["descargado_en"] = datetime.now(UTC).isoformat(timespec="seconds")
        _guardar(DIR_RESENAS / f"{f['appid']}.json", agregado)
        if i % 25 == 0:
            logger.info("Reseñas: %d/%d", i, len(pendientes))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--paso", choices=["candidatos", "fichas", "resenas"])
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    hoy = datetime.now(UTC).date()
    if args.paso in (None, "candidatos"):
        candidatos = paso_candidatos(hoy)
    else:
        candidatos = _leer(config.DIR_RAW / "candidatos.json")
    if args.paso in (None, "fichas"):
        paso_fichas(candidatos)
    if args.paso in (None, "resenas"):
        paso_resenas(hoy)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
