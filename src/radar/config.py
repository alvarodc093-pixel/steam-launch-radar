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
# La API de reseñas solo sirve el último año: un juego lanzado antes tiene su
# primer mes fuera de alcance.
HISTORICO_API_DIAS = 365
DIAS_MARGEN_INICIO = 5  # colchón por zonas horarias y por la fecha de descarga
DIAS_MARGEN = 45  # hasta hoy - 45 días: la ventana de 30 días está cerrada
# La entrada en la muestra se decide con las reseñas del primer mes, la misma
# edad para todos los juegos. Si se decidiera con las que tienen el día de la
# descarga, los lanzamientos recientes necesitarían ser más grandes para
# entrar (sesgo de selección). Debajo de 10 apenas hay nada que leer.
RESENAS_MIN_30D = 10
RESENAS_MAX_30D = 10_000

# Candidatos a descargar, por el recuento del buscador: todo juego con 10
# reseñas en su primer mes tiene hoy al menos 10 (y el buscador no da cifra
# por debajo). El tope de descarga deja margen sobre las 10.000 del primer
# mes; por encima, recorrer el histórico entero costaría cientos de páginas
# por juego.
RESENAS_MIN_TIENDA = 10
RESENAS_MAX_DESCARGA = 30_000

DIAS_VENTANA = 30
# Días tras el lanzamiento en los que el radar hace su lectura.
DIAS_LECTURA = (3, 7, 14)

# Opcional: con una clave de la Steam Web API la descarga incluye las reseñas
# en todos los idiomas (sin ella, la API solo sirve las de inglés).
STEAM_API_KEY = os.getenv("STEAM_API_KEY", "").strip()

CONTACTO = os.getenv("CONTACTO_USER_AGENT", "").strip()
USER_AGENT = "steam-launch-radar/1.0" + (f" (+{CONTACTO})" if CONTACTO else "")


def ventana_lanzamientos(hoy: date) -> tuple[date, date]:
    """Lanzamientos cuyo primer mes completo se puede descargar hoy."""
    desde = hoy - timedelta(days=HISTORICO_API_DIAS - DIAS_MARGEN_INICIO)
    return desde, hoy - timedelta(days=DIAS_MARGEN)
