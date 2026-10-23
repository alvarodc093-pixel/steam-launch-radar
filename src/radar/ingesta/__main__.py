"""Ingesta reanudable: candidatos (SteamSpy) → fichas (tienda) → reseñas.

Uso:
    python -m radar.ingesta                 # los tres pasos
    python -m radar.ingesta --paso resenas  # solo uno
    python -m radar.ingesta --paginas 5     # muestra pequeña para probar

Cada respuesta se guarda en data/raw/ en cuanto llega. Si la ejecución se
corta, al relanzarla se salta lo que ya está descargado.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from radar import config
from radar.ingesta import resenas, steamspy, tienda
from radar.ingesta.http import ClienteHttp, ErrorFuente

logger = logging.getLogger("radar.ingesta")

DIR_SPY = config.DIR_RAW / "steamspy"
DIR_FICHAS = config.DIR_RAW / "fichas"
DIR_RESENAS = config.DIR_RAW / "resenas"


def _leer(ruta: Path) -> Any:
    return json.loads(ruta.read_text(encoding="utf-8"))


def _guardar(ruta: Path, datos: Any) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, default=str), encoding="utf-8")
    tmp.replace(ruta)  # escritura atómica: un corte no deja JSON a medias


def paso_candidatos(paginas: int) -> list[dict[str, Any]]:
    cliente = ClienteHttp(pausa_s=steamspy.PAUSA_S)
    candidatos: dict[int, dict[str, Any]] = {}
    for numero in range(paginas):
        ruta = DIR_SPY / f"pagina_{numero:03d}.json"
        if not ruta.exists():
            logger.info("SteamSpy página %d", numero)
            _guardar(ruta, steamspy.descargar_pagina(cliente, numero))
        for c in steamspy.filtrar_candidatos(
            _leer(ruta), config.RESENAS_MIN, config.RESENAS_MAX
        ):
            candidatos.setdefault(c["appid"], c)
    lista = sorted(candidatos.values(), key=lambda c: c["appid"])
    _guardar(config.DIR_RAW / "candidatos.json", lista)
    logger.info("%d candidatos en %d páginas", len(lista), paginas)
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
    fecha = date.fromisoformat(str(fecha))
    return config.LANZAMIENTO_DESDE <= fecha <= hoy - timedelta(days=config.DIAS_MARGEN)


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
    parser.add_argument("--paginas", type=int, default=25, help="páginas de SteamSpy")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    hoy = datetime.now(UTC).date()
    if args.paso in (None, "candidatos"):
        candidatos = paso_candidatos(args.paginas)
    else:
        candidatos = _leer(config.DIR_RAW / "candidatos.json")
    if args.paso in (None, "fichas"):
        paso_fichas(candidatos)
    if args.paso in (None, "resenas"):
        paso_resenas(hoy)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
