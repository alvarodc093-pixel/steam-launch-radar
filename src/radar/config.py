"""Rutas y parámetros compartidos por la ingesta, la preparación y el modelo."""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
load_dotenv(RAIZ / ".env")

DIR_RAW = RAIZ / "data" / "raw"
DIR_PROCESADO = RAIZ / "data" / "processed"
DIR_APP_DATOS = RAIZ / "app" / "data"

# Muestra: lanzamientos con la ventana de 30 días ya cerrada y con un volumen
# de reseñas que se puede descargar entero (el radar está pensado para
# estudios pequeños y medianos, no para los éxitos con cientos de miles).
LANZAMIENTO_DESDE = date(2024, 1, 1)
DIAS_MARGEN = 45  # hasta hoy - 45 días: la ventana de 30 días está cerrada
RESENAS_MIN = 30
RESENAS_MAX = 10_000

DIAS_VENTANA = 30
# Días tras el lanzamiento en los que el radar hace su lectura.
DIAS_LECTURA = (3, 7, 14)

CONTACTO = os.getenv("CONTACTO_USER_AGENT", "").strip()
USER_AGENT = "steam-launch-radar/1.0" + (f" (+{CONTACTO})" if CONTACTO else "")
