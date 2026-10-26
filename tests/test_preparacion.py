"""Reglas de limpieza y construcción del dataset del radar."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from radar import preparacion as prep


def test_genero_principal_salta_los_genericos() -> None:
    assert prep.genero_principal(["Indie", "Free To Play", "RPG", "Action"]) == "RPG"
    assert prep.genero_principal(["Indie"]) == "Indie"
    assert prep.genero_principal([]) == prep.SIN_GENERO


@pytest.mark.parametrize(
    ("precio", "banda"),
    [
        (0.0, "gratis"),
        (0.99, "hasta_10"),
        (10.0, "hasta_10"),
        (19.99, "hasta_20"),
        (40.0, "hasta_40"),
        (59.99, "mas_de_40"),
        (None, None),
    ],
)
def test_banda_precio(precio, banda) -> None:  # noqa: ANN001
    assert prep.banda_precio(precio) == banda


def _ficha(appid: int, fecha: str, precio: float | None = 9.99) -> dict:
    return {
        "appid": appid,
        "nombre": f"Juego {appid}",
        "fecha_lanzamiento": fecha,
        "precio_usd": precio,
        "gratis": precio == 0,
        "generos": ["Indie", "Strategy"],
        "desarrolladores": ["Estudio"],
        "editores": [],
    }


def _resenas(appid: int, dias: dict[str, list[float]], completo: bool = True) -> dict:
    total = sum(v[0] + v[1] for v in dias.values())
    return {
        "appid": appid,
        "total_api": total,
        "descargadas": total,
        "dias": dias,
        "completo": completo,
    }


@pytest.fixture
def datos() -> tuple[pd.DataFrame, pd.DataFrame]:
    fichas = [
        _ficha(1, "2025-03-01"),
        _ficha(2, "2025-04-01"),  # con muchas reseñas previas
        _ficha(3, "2025-05-01"),  # descarga incompleta
        _ficha(4, "2025-06-01", precio=None),
        {"appid": 5, "descartada": True},
    ]
    resenas = [
        _resenas(
            1,
            {
                "2025-03-01": [10, 0],
                "2025-03-05": [4, 1],
                "2025-03-20": [5, 0],
                "2025-04-15": [9, 9],
            },
        ),
        _resenas(2, {"2025-02-01": [50, 0], "2025-04-02": [10, 0]}),
        _resenas(3, {"2025-05-01": [3, 0]}, completo=False),
        _resenas(4, {"2025-06-01": [3, 0]}),
    ]
    juegos = prep.construir_juegos(fichas, resenas)
    diarias = prep.construir_diarias(resenas, juegos)
    return prep.marcar_aptos(juegos, diarias), diarias


def test_dias_relativos_al_lanzamiento(datos) -> None:  # noqa: ANN001
    _, diarias = datos
    juego1 = diarias[diarias["appid"] == 1].set_index("dia")["resenas"]
    assert juego1.to_dict() == {0: 10, 4: 5, 19: 5, 45: 18}
    assert diarias[diarias["appid"] == 2]["dia"].min() == -59


def test_estados_de_exclusion(datos) -> None:  # noqa: ANN001
    juegos, _ = datos
    estado = juegos.set_index("appid")["estado"].to_dict()
    assert estado == {
        1: "apto",
        2: "fase_previa_publica",
        3: "descarga_incompleta",
        4: "sin_precio_usd",
    }
    assert 5 not in estado  # las fichas descartadas ni siquiera entran


def test_dataset_lecturas_y_objetivo(datos) -> None:  # noqa: ANN001
    juegos, diarias = datos
    ds = prep.construir_dataset(juegos, diarias)
    assert ds["appid"].tolist() == [1]
    fila = ds.iloc[0]
    assert fila["resenas_3d"] == 10  # días 0-2
    assert fila["resenas_7d"] == 15  # días 0-6
    assert fila["resenas_14d"] == 15
    assert fila["resenas_30d"] == 20  # el día 45 queda fuera de la ventana
    assert fila["pct_positivas_7d"] == pytest.approx(14 / 15)
    assert fila["genero_principal"] == "Strategy"


def test_positividad_vacia_sin_resenas() -> None:
    juegos = prep.construir_juegos(
        [_ficha(9, "2025-01-01")], [_resenas(9, {"2025-01-20": [12, 0]})]
    )
    diarias = prep.construir_diarias([_resenas(9, {"2025-01-20": [12, 0]})], juegos)
    ds = prep.construir_dataset(prep.marcar_aptos(juegos, diarias), diarias)
    assert ds.loc[0, "resenas_3d"] == 0
    assert np.isnan(ds.loc[0, "pct_positivas_3d"])


def test_lanzamiento_fuera_del_historico_de_la_api() -> None:
    resenas = [
        {
            **_resenas(1, {"2025-03-01": [12, 0]}),
            "descargado_en": "2025-04-15T10:00:00+00:00",
        },
        {
            **_resenas(2, {"2025-03-01": [12, 0]}),
            "descargado_en": "2026-04-15T10:00:00+00:00",
        },
    ]
    fichas = [_ficha(1, "2025-03-01"), _ficha(2, "2025-03-01")]
    juegos = prep.construir_juegos(fichas, resenas)
    juegos = prep.marcar_aptos(juegos, prep.construir_diarias(resenas, juegos))
    assert juegos.set_index("appid")["estado"].to_dict() == {
        1: "apto",
        2: "fuera_del_historico_api",  # descargado 13 meses después
    }


def test_entra_por_las_resenas_del_primer_mes() -> None:
    # Las dos tienen hoy 40 reseñas, pero la 2 solo 6 en su primer mes: la
    # entrada depende de la misma edad para todos, no del día de la descarga.
    resenas = [
        _resenas(1, {"2025-03-01": [12, 0], "2025-06-01": [28, 0]}),
        _resenas(2, {"2025-03-01": [6, 0], "2025-06-01": [34, 0]}),
    ]
    fichas = [_ficha(1, "2025-03-01"), _ficha(2, "2025-03-01")]
    juegos = prep.construir_juegos(fichas, resenas)
    juegos = prep.marcar_aptos(juegos, prep.construir_diarias(resenas, juegos))
    assert juegos.set_index("appid")["estado"].to_dict() == {
        1: "apto",
        2: "menos_de_10_en_30d",
    }


def test_senales_tempranas_del_formato_nuevo() -> None:
    horas = round(10 * np.log1p(3.0), 3)  # las diez reseñas, con 3 horas cada una
    resenas = [
        _resenas(1, {"2025-03-01": [10, 0, 5, 8, 1, 2, horas]}),
        _resenas(2, {"2025-03-01": [10, 0]}),  # formato antiguo
    ]
    fichas = [_ficha(1, "2025-03-01"), _ficha(2, "2025-03-01")]
    juegos = prep.construir_juegos(fichas, resenas)
    diarias = prep.construir_diarias(resenas, juegos)
    ds = prep.construir_dataset(prep.marcar_aptos(juegos, diarias), diarias)
    nuevo, antiguo = ds.set_index("appid").loc[1], ds.set_index("appid").loc[2]
    assert nuevo["pct_compra_steam_3d"] == pytest.approx(0.8)
    assert nuevo["pct_gratis_3d"] == pytest.approx(0.1)
    assert nuevo["pct_deck_3d"] == pytest.approx(0.2)
    assert nuevo["horas_resena_3d"] == pytest.approx(3.0, abs=0.01)
    # Sin señales medidas no se inventa un 0.
    assert np.isnan(antiguo["pct_compra_steam_3d"])
    assert np.isnan(antiguo["horas_resena_3d"])
