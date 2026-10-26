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
import threading
import time
from concurrent.futures import ThreadPoolExecutor
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


def _guardar(ruta: Path, contenido: Any) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(contenido, ensure_ascii=False, default=str), encoding="utf-8"
    )
    # Escritura atómica: un corte no deja JSON a medias. En Windows, OneDrive
    # o el antivirus pueden tener el fichero abierto un instante.
    for intento in range(5):
        try:
            tmp.replace(ruta)
            return
        except PermissionError:
            time.sleep(0.5 * (intento + 1))
    tmp.replace(ruta)


def paso_candidatos(hoy: date) -> list[dict[str, Any]]:
    """Recorre el buscador desde hoy hacia atrás hasta salir de la ventana.

    Las páginas se guardan por día: el buscador ordena por fecha y cada día
    entran lanzamientos nuevos que desplazan los resultados, así que una
    página de otro día ya no contiene los mismos juegos.
    """
    cliente = ClienteHttp(pausa_s=busqueda.PAUSA_S)
    desde, hasta = config.ventana_lanzamientos(hoy)
    candidatos: dict[int, dict[str, Any]] = {}
    carpeta = DIR_BUSQUEDA / hoy.isoformat()
    inicio = 0
    while True:
        ruta = carpeta / f"desde_{inicio:06d}.json"
        if not ruta.exists():
            _guardar(ruta, busqueda.descargar_pagina(cliente, inicio))
        filas = _leer(ruta)
        for fila in filas:
            fila["fecha"] = (
                date.fromisoformat(fila["fecha"]) if fila.get("fecha") else None
            )
            if busqueda.es_candidato(
                fila,
                desde,
                hasta,
                config.RESENAS_MIN_TIENDA,
                config.RESENAS_MAX_DESCARGA,
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


def al_dia(ruta: Path, clave: str) -> bool:
    """Si la descarga guardada ya tiene el formato y los idiomas actuales."""
    if not ruta.exists():
        return False
    guardado = _leer(ruta)
    idiomas = "todos" if clave else "ingles"
    return guardado.get("formato") == resenas.FORMATO and (
        guardado.get("idiomas") == idiomas
    )


def paso_resenas(hoy: date, hilos: int = 1) -> None:
    clave = config.STEAM_API_KEY
    fichas = [_leer(r) for r in sorted(DIR_FICHAS.glob("*.json"))]
    elegibles = [f for f in fichas if en_ventana(f, hoy)]
    pendientes = [
        f for f in elegibles if not al_dia(DIR_RESENAS / f"{f['appid']}.json", clave)
    ]
    logger.info(
        "Reseñas (%s): %d pendientes de %d juegos en ventana",
        "todos los idiomas" if clave else "solo inglés",
        len(pendientes),
        len(elegibles),
    )
    # Un cliente por hilo, cada uno con su propia pausa entre peticiones.
    clientes = threading.local()

    def descargar(ficha: dict[str, Any]) -> None:
        if not hasattr(clientes, "http"):
            clientes.http = ClienteHttp(pausa_s=resenas.PAUSA_S)
        try:
            agregado = resenas.descargar_resenas(
                clientes.http, ficha["appid"], config.RESENAS_MAX_DESCARGA, clave
            )
        except ErrorFuente as exc:
            logger.warning("Reseñas %s sin descargar: %s", ficha["appid"], exc)
            return
        agregado["appid"] = ficha["appid"]
        agregado["descargado_en"] = datetime.now(UTC).isoformat(timespec="seconds")
        _guardar(DIR_RESENAS / f"{ficha['appid']}.json", agregado)

    with ThreadPoolExecutor(max_workers=hilos) as grupo:
        for i, _ in enumerate(grupo.map(descargar, pendientes), 1):
            if i % 100 == 0:
                logger.info("Reseñas: %d/%d", i, len(pendientes))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--paso", choices=["candidatos", "fichas", "resenas"])
    parser.add_argument(
        "--hilos", type=int, default=1, help="descargas de reseñas en paralelo"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    hoy = datetime.now(UTC).date()
    if args.paso in (None, "candidatos"):
        candidatos = paso_candidatos(hoy)
    else:
        ruta = config.DIR_RAW / "candidatos.json"
        if not ruta.exists():
            logger.error("Falta %s: ejecuta antes el paso de candidatos.", ruta)
            return 1
        candidatos = _leer(ruta)
    if args.paso in (None, "fichas"):
        paso_fichas(candidatos)
    if args.paso in (None, "resenas"):
        paso_resenas(hoy, args.hilos)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
