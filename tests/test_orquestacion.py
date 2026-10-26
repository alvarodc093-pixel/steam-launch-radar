"""Orquestación de la ingesta y del cliente HTTP, sin red y en carpetas temporales."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
import requests
import responses

from radar import config
from radar import preparacion as prep
from radar.ingesta import __main__ as ingesta
from radar.ingesta import busqueda, http, resenas, tienda
from radar.ingesta.http import ClienteHttp, ErrorFuente

HOY = date(2026, 10, 24)


@pytest.fixture
def raw(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirige toda la caché de la ingesta a una carpeta temporal."""
    monkeypatch.setattr(config, "DIR_RAW", tmp_path)
    monkeypatch.setattr(ingesta, "DIR_BUSQUEDA", tmp_path / "busqueda")
    monkeypatch.setattr(ingesta, "DIR_FICHAS", tmp_path / "fichas")
    monkeypatch.setattr(ingesta, "DIR_RESENAS", tmp_path / "resenas")
    monkeypatch.setattr(http.time, "sleep", lambda _s: None)
    monkeypatch.setattr(ingesta.time, "sleep", lambda _s: None)
    return tmp_path


def _fila(appid: int, fecha: date, resenas_tienda: int = 100) -> dict:
    return {
        "appid": appid,
        "nombre": f"J{appid}",
        "fecha": fecha,
        "resenas_tienda": resenas_tienda,
    }


def test_candidatos_recorre_hasta_salir_de_la_ventana(raw, monkeypatch) -> None:  # noqa: ANN001
    paginas = {
        0: [
            _fila(1, date(2026, 10, 1)),
            _fila(2, date(2026, 8, 1)),
        ],  # 1: demasiado reciente
        100: [
            _fila(3, date(2026, 3, 1)),
            _fila(4, date(2026, 3, 1), resenas_tienda=0),  # sin cifra: < 10
        ],
        200: [_fila(5, date(2025, 6, 1))],  # ya fuera de la ventana: aquí se para
        300: [_fila(6, date(2025, 5, 1))],
    }
    pedidas = []

    def descargar(_cliente, inicio):  # noqa: ANN001, ANN202
        pedidas.append(inicio)
        return paginas[inicio]

    monkeypatch.setattr(busqueda, "descargar_pagina", descargar)
    candidatos = ingesta.paso_candidatos(HOY)
    assert [c["appid"] for c in candidatos] == [2, 3]
    assert pedidas == [0, 100, 200]
    assert (
        json.loads((raw / "candidatos.json").read_text(encoding="utf-8"))[0]["appid"]
        == 2
    )

    # Segunda ejecución: todo sale de la caché, sin pedir nada.
    pedidas.clear()
    assert [c["appid"] for c in ingesta.paso_candidatos(HOY)] == [2, 3]
    assert pedidas == []

    # Otro día la caché del buscador no vale: las páginas se desplazan.
    ingesta.paso_candidatos(date(2026, 10, 25))
    assert pedidas == [0, 100, 200]


def test_fichas_guarda_descartes_y_sigue_tras_un_error(raw, monkeypatch) -> None:  # noqa: ANN001
    def descargar(_cliente, appid):  # noqa: ANN001, ANN202
        if appid == 2:
            raise ErrorFuente("caída")
        return (
            None if appid == 3 else {"appid": appid, "fecha_lanzamiento": "2026-03-01"}
        )

    monkeypatch.setattr(tienda, "descargar_ficha", descargar)
    ingesta.paso_fichas([{"appid": 1}, {"appid": 2}, {"appid": 3}])
    guardadas = {p.stem for p in (raw / "fichas").glob("*.json")}
    assert guardadas == {"1", "3"}  # la 2 se reintentará en la próxima ejecución
    assert json.loads((raw / "fichas" / "3.json").read_text(encoding="utf-8"))[
        "descartada"
    ]


def test_resenas_solo_de_juegos_en_ventana(raw, monkeypatch) -> None:  # noqa: ANN001
    (raw / "fichas").mkdir()
    for appid, fecha in [(1, "2026-03-01"), (2, "2024-01-01"), (3, "2026-03-02")]:
        (raw / "fichas" / f"{appid}.json").write_text(
            json.dumps({"appid": appid, "fecha_lanzamiento": fecha}), encoding="utf-8"
        )

    def descargar(_cliente, appid, _maximo):  # noqa: ANN001, ANN202
        if appid == 3:
            raise ErrorFuente("caída")
        return {
            "total_api": 5,
            "descargadas": 5,
            "dias": {"2026-03-01": [5, 0]},
            "completo": True,
        }

    monkeypatch.setattr(resenas, "descargar_resenas", descargar)
    ingesta.paso_resenas(HOY)
    guardadas = sorted(p.stem for p in (raw / "resenas").glob("*.json"))
    assert guardadas == ["1"]
    agregado = json.loads((raw / "resenas" / "1.json").read_text(encoding="utf-8"))
    assert agregado["appid"] == 1 and "descargado_en" in agregado


def test_vuelve_a_descargar_las_de_un_formato_anterior(raw, monkeypatch) -> None:  # noqa: ANN001
    (raw / "fichas").mkdir()
    (raw / "resenas").mkdir()
    for appid in (1, 2):
        (raw / "fichas" / f"{appid}.json").write_text(
            json.dumps({"appid": appid, "fecha_lanzamiento": "2026-03-01"}),
            encoding="utf-8",
        )
    # La 1 es del formato antiguo (solo voto); la 2 ya está al día.
    (raw / "resenas" / "1.json").write_text(json.dumps({"appid": 1}), encoding="utf-8")
    (raw / "resenas" / "2.json").write_text(
        json.dumps({"appid": 2, "formato": resenas.FORMATO}),
        encoding="utf-8",
    )
    pedidas = []

    def descargar(_cliente, appid, _maximo):  # noqa: ANN001, ANN202
        pedidas.append(appid)
        return {"formato": resenas.FORMATO, "dias": {}}

    monkeypatch.setattr(resenas, "descargar_resenas", descargar)
    ingesta.paso_resenas(HOY, hilos=2)
    assert pedidas == [1]


def test_main_sin_candidatos_avisa_y_sale_con_error(raw, caplog) -> None:  # noqa: ANN001
    assert ingesta.main(["--paso", "fichas"]) == 1
    assert "candidatos" in caplog.text


def test_guardar_reintenta_si_el_fichero_esta_bloqueado(raw, monkeypatch) -> None:  # noqa: ANN001
    original = Path.replace
    intentos = {"n": 0}

    def replace(self, destino):  # noqa: ANN001, ANN202
        intentos["n"] += 1
        if intentos["n"] < 3:
            raise PermissionError("bloqueado por otro proceso")
        return original(self, destino)

    monkeypatch.setattr(Path, "replace", replace)
    ingesta._guardar(raw / "x.json", {"a": 1})
    assert json.loads((raw / "x.json").read_text(encoding="utf-8")) == {"a": 1}
    assert intentos["n"] == 3


# --- cliente HTTP -------------------------------------------------------------


@pytest.fixture
def sin_esperas(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    esperas: list[float] = []
    monkeypatch.setattr(http.time, "sleep", esperas.append)
    return esperas


@responses.activate
def test_429_respeta_retry_after(sin_esperas) -> None:  # noqa: ANN001
    responses.get("https://x.test/a", status=429, headers={"Retry-After": "7"})
    responses.get("https://x.test/a", json={"ok": True})
    assert ClienteHttp().get_json("https://x.test/a") == {"ok": True}
    assert 7.0 in sin_esperas


@responses.activate
def test_5xx_y_red_se_reintentan_hasta_agotar(sin_esperas) -> None:  # noqa: ANN001
    responses.get("https://x.test/a", status=503)
    responses.get("https://x.test/a", body=requests.ConnectionError("sin red"))
    responses.get("https://x.test/a", status=500)
    responses.get("https://x.test/a", status=502)
    with pytest.raises(ErrorFuente, match="tras 4 intentos"):
        ClienteHttp().get_json("https://x.test/a")
    assert len(responses.calls) == http.INTENTOS


@responses.activate
def test_respuesta_que_no_es_json() -> None:
    responses.get("https://x.test/a", body="<html>mantenimiento</html>")
    with pytest.raises(ErrorFuente, match="no devolvió JSON"):
        ClienteHttp().get_json("https://x.test/a")


def test_pausa_entre_peticiones(monkeypatch) -> None:  # noqa: ANN001
    esperas: list[float] = []
    monkeypatch.setattr(http.time, "sleep", esperas.append)
    cliente = ClienteHttp(pausa_s=1.5)
    cliente._esperar_turno()
    cliente._esperar_turno()
    assert esperas and 0 < esperas[0] <= 1.5


@responses.activate
def test_descargas_de_tienda_y_buscador() -> None:
    responses.get(
        tienda.URL,
        json={
            "10": {
                "success": True,
                "data": {
                    "type": "game",
                    "name": "X",
                    "release_date": {"date": "Mar 3, 2026"},
                },
            }
        },
    )
    assert tienda.descargar_ficha(ClienteHttp(), 10)["nombre"] == "X"
    responses.get(busqueda.URL, json={"results_html": ""})
    assert busqueda.descargar_pagina(ClienteHttp(), 0) == []


# --- main de la preparación ---------------------------------------------------


def test_preparacion_main_de_cache_a_csv(raw, tmp_path_factory, monkeypatch) -> None:  # noqa: ANN001
    salida = tmp_path_factory.mktemp("procesado")
    monkeypatch.setattr(config, "DIR_PROCESADO", salida)
    (raw / "fichas").mkdir()
    (raw / "resenas").mkdir()
    candidatos = []
    for appid in (1, 2):
        candidatos.append({"appid": appid})
        (raw / "fichas" / f"{appid}.json").write_text(
            json.dumps(
                {
                    "appid": appid,
                    "nombre": "J",
                    "fecha_lanzamiento": "2026-03-01",
                    "precio_usd": 9.99,
                    "generos": ["RPG"],
                }
            ),
            encoding="utf-8",
        )
        (raw / "resenas" / f"{appid}.json").write_text(
            json.dumps(
                {
                    "appid": appid,
                    "total_api": 3,
                    "descargadas": 3,
                    "completo": True,
                    "descargado_en": "2026-10-24T00:00:00+00:00",
                    "dias": {"2026-03-01": [2, 0], "2026-03-04": [1, 0]},
                }
            ),
            encoding="utf-8",
        )
    # Una ficha antigua en la caché que ya no es candidata no debe colarse.
    (raw / "fichas" / "9.json").write_text(json.dumps({"appid": 9}), encoding="utf-8")
    (raw / "candidatos.json").write_text(json.dumps(candidatos), encoding="utf-8")

    assert prep.main() == 0
    juegos = (salida / "juegos.csv").read_text(encoding="utf-8")
    assert juegos.count("\n") == 3  # cabecera + 2 juegos
    assert (salida / "dataset_radar.csv").exists()


def test_preparacion_sin_cache(raw) -> None:  # noqa: ANN001
    with pytest.raises(FileNotFoundError, match="ingesta"):
        prep.cargar_crudo()
    (raw / "candidatos.json").write_text("[]", encoding="utf-8")
    assert prep.main() == 1
