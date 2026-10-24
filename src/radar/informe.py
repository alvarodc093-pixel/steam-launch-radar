"""Resumen en Markdown de la muestra y las métricas exportadas en app/data.

Lo usa el workflow de actualización mensual como cuerpo del Pull Request,
para revisar las cifras antes de aceptar los datos nuevos.

Uso:
    python -m radar.informe > resumen.md
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from radar import config

NOMBRES = {
    "mediana": "Mediana",
    "ratio_tipico": "Ratio típico",
    "ridge": "Ridge",
    "gradient_boosting": "Gradient boosting",
}


def _leer(carpeta: Path, nombre: str) -> dict[str, Any]:
    return json.loads((carpeta / nombre).read_text(encoding="utf-8"))


def _num(valor: float, cifras: int) -> str:
    return f"{valor:.{cifras}f}".replace(".", ",")


def _pct(valor: float) -> str:
    # Con un decimal: un 99,5 % redondeado a «100 %» daría una idea falsa.
    return f"{_num(valor * 100, 1)} %"


def resumen(carpeta: Path) -> str:
    radar = _leer(carpeta, "radar.json")
    previo = _leer(carpeta, "previo.json")["modelo"]
    mercado = _leer(carpeta, "mercado.json")

    rango = mercado["rango_lanzamientos"]
    exclusiones = ", ".join(f"{k}: {v}" for k, v in mercado["exclusiones"].items())
    lineas = [
        f"Datos generados el {radar['generado_en']}.",
        "",
        f"- **Muestra:** {mercado['juegos_aptos']} lanzamientos aptos de "
        f"{mercado['juegos_descargados']} descargados, del {rango['desde']} "
        f"al {rango['hasta']}.",
        f"- **Estados:** {exclusiones}.",
        f"- **Mediana de reseñas a 30 días:** {mercado['mediana_resenas_30d']:.0f}.",
        "",
        "| Lectura | Modelo | Factor de error típico | Dentro de ×2 | Cobertura del 90 % |",
        "| --- | --- | --- | --- | --- |",
    ]
    for dia, modelo in radar["modelos"].items():
        test = modelo["metricas_test"]
        lineas.append(
            f"| Día {dia} | {NOMBRES.get(modelo['tipo'], modelo['tipo'])} "
            f"| ×{_num(test['factor_error_tipico'], 2)} | {_pct(test['dentro_de_x2'])} "
            f"| {_pct(test['cobertura_90'])} |"
        )
    base = previo["baselines_test"].get("mediana")
    test = previo["metricas_test"]
    lineas += [
        "",
        f"**Antes de lanzar** ({NOMBRES.get(previo['tipo'], previo['tipo'])}): "
        f"error medio {_num(test['mae_log'], 3)} y del juego típico "
        f"{_num(test['mediana_error_log'], 3)} en log"
        + (
            f"; la mediana, {_num(base['mae_log'], 3)} y "
            f"{_num(base['mediana_error_log'], 3)}."
            if base
            else "."
        ),
    ]
    return "\n".join(lineas) + "\n"


def main() -> int:
    try:
        sys.stdout.write(resumen(config.DIR_APP_DATOS))
    except FileNotFoundError as exc:
        sys.stderr.write(f"{exc}. Ejecuta antes python -m radar.exportar.\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
