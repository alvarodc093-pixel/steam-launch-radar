"""Tablas y proyecto de Power BI."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from radar import config, powerbi
from radar.exportar import cargar_procesados


@pytest.fixture(scope="module")
def procesados():
    return cargar_procesados(config.DIR_PROCESADO)


def test_curva_diaria_rellena_los_dias_sin_resenas():
    diarias = pd.DataFrame(
        {
            "appid": [1, 1, 1, 1],
            "dia": [-2, 0, 2, 40],  # fuera del primer mes: el -2 y el 40
            "positivas": [1, 3, 1, 9],
            "negativas": [0, 1, 0, 0],
            "resenas": [1, 4, 1, 9],
        }
    )
    dataset = pd.DataFrame({"appid": [1], "resenas_30d": [5]})
    curva = powerbi.tabla_curva(diarias, dataset)
    assert len(curva) == config.DIAS_VENTANA
    assert curva["dia"].tolist()[:3] == [1, 2, 3]
    assert curva["resenas_acumuladas"].tolist()[:3] == [4, 4, 5]
    assert curva["fraccion_mes"].iloc[-1] == 1


def test_juegos_marca_conjunto_y_banda(procesados):
    dataset, juegos, _ = procesados
    tabla = powerbi.tabla_juegos(juegos, dataset)
    assert len(tabla) == len(juegos)
    assert set(tabla["conjunto"]) == {
        "Entrenamiento",
        "Calibración",
        "Test",
        "Excluido",
    }
    excluidos = tabla["estado"] != "apto"
    assert (tabla.loc[excluidos, "conjunto"] == "Excluido").all()
    assert tabla["banda_precio"].notna().all()
    assert (tabla.loc[tabla["precio_usd"].isna(), "banda_precio"] == "Sin precio").all()


def test_calendario_cubre_los_lanzamientos(procesados):
    _, juegos, _ = procesados
    calendario = powerbi.tabla_calendario(juegos)
    fechas = juegos["fecha_lanzamiento"].dt.strftime("%Y-%m-%d")
    assert fechas.isin(calendario["fecha"]).all()
    assert calendario["fecha"].is_unique


def test_las_metricas_del_panel_coinciden_con_la_app(procesados):
    dataset, _, _ = procesados
    predicciones, metricas = powerbi.tablas_modelo(dataset)
    radar = json.loads((config.DIR_APP_DATOS / "radar.json").read_text("utf-8"))
    for dia, grupo in predicciones.groupby("dia_lectura"):
        test = radar["modelos"][str(dia)]["metricas_test"]
        factor = np.exp(grupo["error_log"].median())
        assert factor == pytest.approx(test["factor_error_tipico"], abs=0.002)
        assert grupo["dentro_rango"].mean() == pytest.approx(
            test["cobertura_90"], abs=0.002
        )
    assert (predicciones["estimacion"] >= predicciones["resenas_lectura"]).all()
    elegidos = metricas[metricas["elegido"] == "Sí"]
    assert sorted(elegidos["dia_lectura"]) == [0, *config.DIAS_LECTURA]


def test_tmdl_de_una_tabla():
    texto = powerbi.tmdl_tabla("predicciones")
    assert texto.startswith("table predicciones\n")
    assert "\t/// Lanzamientos más recientes" in texto
    assert "\tmeasure 'Factor de error típico' = ```" in texto
    assert "SELECTEDVALUE(lecturas[dia_lectura], 7)" in texto
    assert "\tpartition predicciones = m" in texto
    assert '{"estimacion", type number}' in texto
    calendario = powerbi.tmdl_tabla("calendario")
    assert calendario.startswith("table calendario\n\tdataCategory: Time\n")
    assert "\t\tisKey" in calendario
    lecturas = powerbi.tmdl_tabla("lecturas")
    assert "sortByColumn: dia_lectura" in lecturas
    assert "\t\tisHidden" in lecturas


def test_proyecto_completo(tmp_path):
    ajustes = tmp_path / f"{powerbi.NOMBRE}.Report" / ".pbi" / "localSettings.json"
    ajustes.parent.mkdir(parents=True)
    ajustes.write_text("{}")
    viejo = tmp_path / f"{powerbi.NOMBRE}.Report" / "sobra.json"
    viejo.write_text("{}")

    powerbi.escribir_proyecto(tmp_path)

    assert ajustes.exists()  # la configuración local de Desktop se respeta
    assert not viejo.exists()  # lo demás se regenera
    pbip = json.loads((tmp_path / f"{powerbi.NOMBRE}.pbip").read_text("utf-8"))
    assert pbip["artifacts"][0]["report"]["path"] == f"{powerbi.NOMBRE}.Report"

    modelo = tmp_path / f"{powerbi.NOMBRE}.SemanticModel" / "definition"
    assert {p.stem for p in (modelo / "tables").glob("*.tmdl")} == set(powerbi.COLUMNAS)
    assert powerbi.ORIGEN_GITHUB in (modelo / "expressions.tmdl").read_text("utf-8")
    relaciones = (modelo / "relationships.tmdl").read_text("utf-8")
    assert relaciones.count("relationship ") == len(powerbi.RELACIONES)

    paginas = tmp_path / f"{powerbi.NOMBRE}.Report" / "definition" / "pages"
    orden = json.loads((paginas / "pages.json").read_text("utf-8"))["pageOrder"]
    assert orden == ["mercado", "ritmo", "modelo", "detalle"]
    visuales = list(paginas.glob("*/visuals/*/visual.json"))
    assert len(visuales) == sum(len(v) for _, _, v in powerbi.paginas())
    medidas = {m.nombre for lista in powerbi.MEDIDAS.values() for m in lista}
    columnas = {(t, c.nombre) for t, cs in powerbi.COLUMNAS.items() for c in cs}
    for ruta in visuales:
        visual = json.loads(ruta.read_text("utf-8"))
        assert visual["name"] == ruta.parent.name
        for rol in visual["visual"]["query"]["queryState"].values():
            for p in rol["projections"]:
                if "Measure" in p["field"]:
                    assert p["field"]["Measure"]["Property"] in medidas
                else:
                    campo = p["field"]["Column"]
                    entidad = campo["Expression"]["SourceRef"]["Entity"]
                    assert (entidad, campo["Property"]) in columnas


def test_main_solo_regenera_el_proyecto_si_se_pide(monkeypatch, tmp_path):
    monkeypatch.setattr(powerbi, "DIR_POWERBI", tmp_path)
    monkeypatch.setattr(
        powerbi,
        "tablas_modelo",
        lambda dataset: (pd.DataFrame({"appid": [1]}), pd.DataFrame({"modelo": ["x"]})),
    )
    guardado = tmp_path / f"{powerbi.NOMBRE}.Report" / "guardado_en_desktop.json"
    guardado.parent.mkdir(parents=True)
    guardado.write_text("{}")

    # Por defecto (la actualización mensual) solo se renuevan los CSV.
    powerbi.main([])
    assert {p.stem for p in (tmp_path / "datos").glob("*.csv")} == {
        "juegos",
        "calendario",
        "lecturas",
        "curva_diaria",
        "predicciones",
        "metricas",
    }
    assert guardado.exists()
    assert not (tmp_path / f"{powerbi.NOMBRE}.pbip").exists()

    powerbi.main(["--proyecto"])
    assert (tmp_path / f"{powerbi.NOMBRE}.pbip").exists()
    assert not guardado.exists()
