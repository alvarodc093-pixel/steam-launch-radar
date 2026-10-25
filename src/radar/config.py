"""Rutas y parámetros compartidos por la ingesta, la preparación y el modelo."""

from __future__ import annotations

import os
from datetime import date, timedelta
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
# La API de reseñas sin clave solo sirve el último año: un juego lanzado
# antes tiene su primer mes fuera de alcance.
HISTORICO_API_DIAS = 365
DIAS_MARGEN_INICIO = 5  # colchón por zonas horarias y por la fecha de descarga
DIAS_MARGEN = 45  # hasta hoy - 45 días: la ventana de 30 días está cerrada
# Sobre el recuento del buscador, que cuenta todos los idiomas salvo en los
# juegos con muchas reseñas, donde Steam solo cuenta las del idioma de la
# consulta (inglés): el mínimo va sobre todas y el máximo, en la práctica,
# sobre las de inglés. La API solo sirve las de inglés, en la mediana un 41 %
# del total, y con menos de 50 apenas quedarían datos que leer.
RESENAS_MIN = 50
RESENAS_MAX = 10_000

DIAS_VENTANA = 30
# Días tras el lanzamiento en los que el radar hace su lectura.
DIAS_LECTURA = (3, 7, 14)

CONTACTO = os.getenv("CONTACTO_USER_AGENT", "").strip()
USER_AGENT = "steam-launch-radar/1.0" + (f" (+{CONTACTO})" if CONTACTO else "")


def ventana_lanzamientos(hoy: date) -> tuple[date, date]:
    """Lanzamientos cuyo primer mes completo se puede descargar hoy."""
    desde = hoy - timedelta(days=HISTORICO_API_DIAS - DIAS_MARGEN_INICIO)
    return desde, hoy - timedelta(days=DIAS_MARGEN)
