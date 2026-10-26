"""Cliente HTTP con espera entre peticiones y reintentos.

Steam no publica un límite exacto para estos endpoints, pero
cortan con 429 o 5xx si se les pide demasiado rápido. Por eso cada fuente
fija su ritmo y aquí se respeta `Retry-After` y se reintenta con espera
creciente antes de dar el dato por perdido.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from radar.config import USER_AGENT

logger = logging.getLogger(__name__)

INTENTOS = 4
ESPERA_BASE_S = 2.0


class ErrorFuente(RuntimeError):
    """La fuente no devolvió un dato utilizable tras agotar los reintentos."""


class ClienteHttp:
    def __init__(self, pausa_s: float = 0.0, timeout_s: int = 30) -> None:
        self._pausa_s = pausa_s
        self._timeout_s = timeout_s
        self._ultima = 0.0
        self._sesion = requests.Session()
        self._sesion.headers["User-Agent"] = USER_AGENT

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        motivo = "sin detalle"
        for intento in range(INTENTOS):
            self._esperar_turno()
            try:
                resp = self._sesion.get(url, params=params, timeout=self._timeout_s)
            except requests.RequestException as exc:
                motivo = f"red: {exc}"
            else:
                if resp.status_code == 429:
                    espera = _retry_after(resp) or ESPERA_BASE_S * 2 ** (intento + 1)
                    logger.warning("429 en %s, espero %.0f s", url, espera)
                    time.sleep(espera)
                    continue
                if resp.status_code < 400:
                    try:
                        return resp.json()
                    except ValueError as exc:
                        raise ErrorFuente(f"{url} no devolvió JSON") from exc
                if resp.status_code < 500:
                    # 4xx distinto de 429: reintentar no lo va a arreglar.
                    raise ErrorFuente(f"HTTP {resp.status_code} en {url}")
                motivo = f"HTTP {resp.status_code}"
            logger.warning(
                "Intento %d/%d fallido en %s (%s)", intento + 1, INTENTOS, url, motivo
            )
            time.sleep(ESPERA_BASE_S * 2**intento)
        raise ErrorFuente(f"{url}: {motivo} tras {INTENTOS} intentos")

    def _esperar_turno(self) -> None:
        restante = self._pausa_s - (time.monotonic() - self._ultima)
        if restante > 0:
            time.sleep(restante)
        self._ultima = time.monotonic()


def _retry_after(resp: requests.Response) -> float | None:
    valor = resp.headers.get("Retry-After", "").strip()
    return float(valor) if valor.isdigit() else None
