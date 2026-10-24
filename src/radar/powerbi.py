"""Panel de Power BI: tablas en estrella y proyecto .pbip que las lee.

Genera dos cosas:

- `powerbi/datos/`: cinco CSV en estrella. `juegos` (una fila por juego
  descargado), `calendario` y `lecturas` (días 3, 7 y 14, y 0 para «antes de
  lanzar») como dimensiones; `curva_diaria` (el primer mes de cada juego apto,
  día a día), `predicciones` (lo que estimó el radar para cada juego del test
  frente a lo que pasó) y `metricas` (los candidatos de cada modelo en test)
  como hechos.
- `powerbi/SteamLaunchRadar.*`: el proyecto de Power BI en formato de texto
  (modelo semántico en TMDL e informe en PBIR), que se abre con Power BI
  Desktop desde `SteamLaunchRadar.pbip`.

Las consultas leen los CSV de la rama principal del repositorio en GitHub, así
que el informe se actualiza con un clic cuando llegan datos nuevos. El
parámetro `OrigenDatos` admite también una carpeta local.

Uso:
    python -m radar.powerbi
"""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from radar import config
from radar import modelo as m
from radar.exportar import cargar_procesados, predecir_python

logger = logging.getLogger("radar.powerbi")

DIR_POWERBI = config.RAIZ / "powerbi"
NOMBRE = "SteamLaunchRadar"
ORIGEN_GITHUB = (
    "https://raw.githubusercontent.com/alvarodc093-pixel/steam-launch-radar/"
    "main/powerbi/datos/"
)

BANDAS = {
    "gratis": (1, "Gratis"),
    "hasta_10": (2, "Hasta 10 $"),
    "hasta_20": (3, "10-20 $"),
    "hasta_40": (4, "20-40 $"),
    "mas_de_40": (5, "Más de 40 $"),
}
SIN_PRECIO = (6, "Sin precio")  # los 4 juegos sin precio en dólares
ESTADOS = {
    "apto": "Apto",
    "sin_resenas_en_30d": "Sin reseñas en inglés en 30 días",
    "fase_previa_publica": "Venía de acceso anticipado",
    "sin_precio_usd": "Sin precio en dólares",
}
MODELOS = {
    "mediana": "Mediana (baseline)",
    "ratio_tipico": "Ratio típico",
    "ridge": "Ridge",
    "gradient_boosting": "Gradient boosting",
}


# --- tablas ------------------------------------------------------------------


def tabla_juegos(juegos: pd.DataFrame, dataset: pd.DataFrame) -> pd.DataFrame:
    train, calib, test = m.particion_temporal(dataset)
    conjunto = {
        **dict.fromkeys(train["appid"], "Entrenamiento"),
        **dict.fromkeys(calib["appid"], "Calibración"),
        **dict.fromkeys(test["appid"], "Test"),
    }
    pct7 = dataset.set_index("appid")["pct_positivas_7d"]
    t = pd.DataFrame(
        {
            "appid": juegos["appid"],
            "nombre": juegos["nombre"],
            "fecha_lanzamiento": juegos["fecha_lanzamiento"].dt.strftime("%Y-%m-%d"),
            "precio_usd": juegos["precio_usd"],
            "banda_precio": juegos["banda_precio"].map(
                lambda b: BANDAS.get(b, SIN_PRECIO)[1]
            ),
            "banda_orden": juegos["banda_precio"].map(
                lambda b: BANDAS.get(b, SIN_PRECIO)[0]
            ),
            "genero_principal": juegos["genero_principal"],
            "es_indie": np.where(juegos["es_indie"], "Sí", "No"),
            "desarrollador": juegos["desarrollador"],
            "editor": juegos["editor"],
            "estado": juegos["estado"],
            "estado_descripcion": juegos["estado"]
            .map(ESTADOS)
            .fillna(juegos["estado"]),
            "resenas_30d": juegos["resenas_30d"].fillna(0).astype(int),
            "pct_positivas_7d": juegos["appid"].map(pct7),
            "conjunto": juegos["appid"].map(conjunto).fillna("Excluido"),
        }
    )
    return t.sort_values("appid")


def tabla_calendario(juegos: pd.DataFrame) -> pd.DataFrame:
    inicio = juegos["fecha_lanzamiento"].min().replace(day=1)
    fin = juegos["fecha_lanzamiento"].max() + pd.offsets.MonthEnd(0)
    fechas = pd.date_range(inicio, fin, freq="D")
    return pd.DataFrame(
        {
            "fecha": fechas.strftime("%Y-%m-%d"),
            "anio": fechas.year,
            "mes": fechas.strftime("%Y-%m"),
            "trimestre": [f"{f.year} T{f.quarter}" for f in fechas],
            "dia_semana": fechas.dayofweek + 1,
        }
    )


def tabla_curva(diarias: pd.DataFrame, dataset: pd.DataFrame) -> pd.DataFrame:
    """Primer mes de cada juego apto: reseñas por día, acumuladas y fracción del mes.

    `dia` cuenta los días transcurridos (1 = el día del lanzamiento), igual que
    el eje de la app: el «día 7» incluye las reseñas de los días 0 a 6.
    """
    aptos = dataset[["appid", "resenas_30d"]]
    mes = diarias[(diarias["dia"] >= 0) & (diarias["dia"] < config.DIAS_VENTANA)]
    rejilla = pd.MultiIndex.from_product(
        [aptos["appid"], range(config.DIAS_VENTANA)], names=["appid", "dia"]
    ).to_frame(index=False)
    t = rejilla.merge(mes[["appid", "dia", "resenas"]], how="left").fillna(0)
    t["resenas"] = t["resenas"].astype(int)
    t["resenas_acumuladas"] = t.groupby("appid")["resenas"].cumsum()
    t = t.merge(aptos, on="appid")
    t["fraccion_mes"] = (t["resenas_acumuladas"] / t["resenas_30d"]).round(4)
    t["dia"] += 1
    return t[["appid", "dia", "resenas", "resenas_acumuladas", "fraccion_mes"]]


def tablas_modelo(dataset: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Predicciones del radar en test y métricas de todos los candidatos."""
    _, _, test = m.particion_temporal(dataset)
    real = test["resenas_30d"].to_numpy(float)
    predicciones, metricas = [], []

    def filas_metricas(dia: int, res: m.Resultado) -> None:
        for nombre, valores in [(res.nombre, res.test), *res.test_baselines.items()]:
            metricas.append(
                {
                    "dia_lectura": dia,
                    "modelo": MODELOS[nombre],
                    "elegido": "Sí" if nombre == res.nombre else "No",
                    "mae_log": valores["mae_log"],
                    "factor_error": valores["factor_error_tipico"],
                    "dentro_x2": valores["dentro_de_x2"],
                    "cv_mae_log": round(
                        float(res.cv.loc[res.cv["modelo"] == nombre, "mae_log"].mean()),
                        4,
                    ),
                }
            )

    for dia in config.DIAS_LECTURA:
        res = m.entrenar(
            dataset, m.variables_radar(dia), columna_ratio=f"log_resenas_{dia}d"
        )
        filas_metricas(dia, res)
        log = predecir_python(res, test)
        lectura = test[f"resenas_{dia}d"].to_numpy(float)
        # Igual que la app: al mes no puede haber menos de lo que ya hay hoy.
        central = np.maximum(lectura, np.expm1(log))
        inferior = np.maximum(lectura, np.expm1(log - res.q90))
        superior = np.maximum(lectura, np.expm1(log + res.q90))
        error = np.abs(np.log1p(real) - log)
        predicciones.append(
            pd.DataFrame(
                {
                    "appid": test["appid"].to_numpy(),
                    "dia_lectura": dia,
                    "resenas_lectura": lectura.astype(int),
                    "estimacion": central.round(1),
                    "rango_inferior": inferior.round(1),
                    "rango_superior": superior.round(1),
                    "resenas_30d_reales": real.astype(int),
                    "error_log": error.round(4),
                    "dentro_rango": (error <= res.q90).astype(int),
                }
            )
        )
    filas_metricas(0, m.entrenar(dataset, m.VARIABLES_PREVIAS))
    return pd.concat(predicciones, ignore_index=True), pd.DataFrame(metricas)


def tabla_lecturas() -> pd.DataFrame:
    dias = [0, *config.DIAS_LECTURA]
    return pd.DataFrame(
        {
            "dia_lectura": dias,
            "lectura": ["Antes de lanzar", *(f"Día {d}" for d in config.DIAS_LECTURA)],
        }
    )


def escribir_datos(carpeta: Path) -> dict[str, pd.DataFrame]:
    dataset, juegos, diarias = cargar_procesados(config.DIR_PROCESADO)
    predicciones, metricas = tablas_modelo(dataset)
    tablas = {
        "juegos": tabla_juegos(juegos, dataset),
        "calendario": tabla_calendario(juegos),
        "lecturas": tabla_lecturas(),
        "curva_diaria": tabla_curva(diarias, dataset),
        "predicciones": predicciones,
        "metricas": metricas,
    }
    carpeta.mkdir(parents=True, exist_ok=True)
    for nombre, tabla in tablas.items():
        tabla.to_csv(carpeta / f"{nombre}.csv", index=False, encoding="utf-8")
        logger.info("Escrito %s.csv (%d filas)", nombre, len(tabla))
    return tablas


# --- modelo semántico (TMDL) -----------------------------------------------


def _id(*partes: str) -> str:
    """Identificador estable: regenerar el proyecto no cambia los lineageTag."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "steam-launch-radar/" + "/".join(partes)))


@dataclass
class Columna:
    nombre: str
    tipo: str  # int64, double, string, dateTime
    formato: str | None = None
    ordenar_por: str | None = None
    oculta: bool = False


@dataclass
class Medida:
    nombre: str
    dax: str
    formato: str
    descripcion: str


M_TIPOS = {
    "int64": "Int64.Type",
    "double": "type number",
    "string": "type text",
    "dateTime": "type date",
}

COLUMNAS: dict[str, list[Columna]] = {
    "juegos": [
        Columna("appid", "int64", "0"),
        Columna("nombre", "string"),
        Columna("fecha_lanzamiento", "dateTime", "dd/mm/yyyy"),
        Columna("precio_usd", "double", "#,0.00 $"),
        Columna("banda_precio", "string", ordenar_por="banda_orden"),
        Columna("banda_orden", "int64", "0", oculta=True),
        Columna("genero_principal", "string"),
        Columna("es_indie", "string"),
        Columna("desarrollador", "string"),
        Columna("editor", "string"),
        Columna("estado", "string"),
        Columna("estado_descripcion", "string"),
        Columna("resenas_30d", "int64", "#,0"),
        Columna("pct_positivas_7d", "double", "0 %"),
        Columna("conjunto", "string"),
    ],
    "calendario": [
        Columna("fecha", "dateTime", "dd/mm/yyyy"),
        Columna("anio", "int64", "0"),
        Columna("mes", "string"),
        Columna("trimestre", "string"),
        Columna("dia_semana", "int64", "0"),
    ],
    "lecturas": [
        Columna("dia_lectura", "int64", "0", oculta=True),
        Columna("lectura", "string", ordenar_por="dia_lectura"),
    ],
    "curva_diaria": [
        Columna("appid", "int64", "0", oculta=True),
        Columna("dia", "int64", "0"),
        Columna("resenas", "int64", "#,0"),
        Columna("resenas_acumuladas", "int64", "#,0"),
        Columna("fraccion_mes", "double", "0 %"),
    ],
    "predicciones": [
        Columna("appid", "int64", "0", oculta=True),
        Columna("dia_lectura", "int64", "0", oculta=True),
        Columna("resenas_lectura", "int64", "#,0"),
        Columna("estimacion", "double", "#,0"),
        Columna("rango_inferior", "double", "#,0"),
        Columna("rango_superior", "double", "#,0"),
        Columna("resenas_30d_reales", "int64", "#,0"),
        Columna("error_log", "double", "0.000"),
        Columna("dentro_rango", "int64", "0"),
    ],
    "metricas": [
        Columna("dia_lectura", "int64", "0", oculta=True),
        Columna("modelo", "string"),
        Columna("elegido", "string"),
        Columna("mae_log", "double", "0.000"),
        Columna("factor_error", "double", "0.00"),
        Columna("dentro_x2", "double", "0 %"),
        Columna("cv_mae_log", "double", "0.000"),
    ],
}

# La lectura elegida en el segmentador, o la del día 7 si no hay ninguna: así
# las tarjetas y el gráfico de dispersión no mezclan las tres lecturas.
_LECTURA = "VAR d = SELECTEDVALUE(lecturas[dia_lectura], 7)\n"

MEDIDAS: dict[str, list[Medida]] = {
    "juegos": [
        Medida(
            "Lanzamientos",
            "COUNTROWS(juegos)",
            "#,0",
            "Juegos descargados del buscador de Steam.",
        ),
        Medida(
            "Lanzamientos aptos",
            'CALCULATE(COUNTROWS(juegos), juegos[estado] = "apto")',
            "#,0",
            "Juegos que entran en el modelo tras la limpieza.",
        ),
        Medida(
            "% excluidos",
            "DIVIDE([Lanzamientos] - [Lanzamientos aptos], [Lanzamientos])",
            "0.0 %",
            "Parte de los juegos descargados que se excluye en el preprocesamiento.",
        ),
        Medida(
            "Mediana reseñas 30 días",
            'CALCULATE(MEDIAN(juegos[resenas_30d]), juegos[estado] = "apto")',
            "#,0",
            "Reseñas en inglés al cumplir 30 días del juego mediano.",
        ),
        Medida(
            "Mediana positivas 7 días",
            'CALCULATE(MEDIAN(juegos[pct_positivas_7d]), juegos[estado] = "apto")',
            "0 %",
            "Porcentaje de reseñas positivas en la primera semana del juego mediano.",
        ),
    ],
    "curva_diaria": [
        Medida(
            "% del mes recibido",
            "MEDIAN(curva_diaria[fraccion_mes])",
            "0 %",
            "Parte de las reseñas del primer mes que ya ha llegado (juego mediano).",
        ),
        *(
            Medida(
                f"Recibido día {d}",
                f"CALCULATE([% del mes recibido], curva_diaria[dia] = {d})",
                "0 %",
                f"Parte del mes que ya ha llegado el día {d} (juego mediano).",
            )
            for d in config.DIAS_LECTURA
        ),
    ],
    "predicciones": [
        Medida(
            "Juegos de test",
            "DISTINCTCOUNT(predicciones[appid])",
            "#,0",
            "Lanzamientos más recientes, que el modelo no vio al entrenar.",
        ),
        Medida(
            "Factor de error típico",
            _LECTURA + "RETURN CALCULATE(EXP(MEDIAN(predicciones[error_log])), "
            "lecturas[dia_lectura] = d)",
            "0.00",
            "exp(mediana del error en log): ×1,21 es un 21 % de desviación.",
        ),
        Medida(
            "Cobertura del rango",
            _LECTURA + "RETURN CALCULATE(AVERAGE(predicciones[dentro_rango]), "
            "lecturas[dia_lectura] = d)",
            "0 %",
            "Juegos cuyo valor real cae dentro del rango del 90 %.",
        ),
        Medida(
            "Dentro de x2",
            _LECTURA + "RETURN CALCULATE(AVERAGEX(predicciones, "
            "IF(predicciones[error_log] <= LN(2), 1, 0)), lecturas[dia_lectura] = d)",
            "0 %",
            "Estimaciones entre la mitad y el doble del valor real.",
        ),
        Medida(
            "Estimación",
            _LECTURA + "RETURN CALCULATE(AVERAGE(predicciones[estimacion]), "
            "lecturas[dia_lectura] = d)",
            "#,0",
            "Reseñas a 30 días que estimó el radar.",
        ),
        Medida(
            "Reseñas reales",
            _LECTURA + "RETURN CALCULATE(AVERAGE(predicciones[resenas_30d_reales]), "
            "lecturas[dia_lectura] = d)",
            "#,0",
            "Reseñas que tuvo de verdad al cumplir 30 días.",
        ),
    ],
    "metricas": [
        Medida(
            "Factor de error en test",
            _LECTURA + "RETURN CALCULATE(AVERAGE(metricas[factor_error]), "
            "lecturas[dia_lectura] = d)",
            "0.00",
            "Factor de error típico de cada candidato en test.",
        ),
    ],
}

RELACIONES = [
    ("juegos", "fecha_lanzamiento", "calendario", "fecha"),
    ("curva_diaria", "appid", "juegos", "appid"),
    ("predicciones", "appid", "juegos", "appid"),
    ("predicciones", "dia_lectura", "lecturas", "dia_lectura"),
    ("metricas", "dia_lectura", "lecturas", "dia_lectura"),
]


def _sangrar(texto: str, tabs: int) -> str:
    return "\n".join("\t" * tabs + linea for linea in texto.splitlines())


def consulta_m(tabla: str, columnas: list[Columna]) -> str:
    tipos = ", ".join(f'{{"{c.nombre}", {M_TIPOS[c.tipo]}}}' for c in columnas)
    return "\n".join(
        [
            "let",
            f'    Ruta = OrigenDatos & "{tabla}.csv",',
            '    Contenido = if Text.StartsWith(Ruta, "http") then Web.Contents(Ruta)'
            " else File.Contents(Ruta),",
            '    Origen = Csv.Document(Contenido, [Delimiter = ",", Encoding = 65001,'
            " QuoteStyle = QuoteStyle.Csv]),",
            "    Encabezados = Table.PromoteHeaders(Origen, [PromoteAllScalars = true]),",
            # Cultura fija: los decimales del CSV llevan punto en cualquier equipo.
            f'    Tipos = Table.TransformColumnTypes(Encabezados, {{{tipos}}}, "en-US")',
            "in",
            "    Tipos",
        ]
    )


def tmdl_tabla(tabla: str) -> str:
    lineas = [f"table {tabla}", f"\tlineageTag: {_id(tabla)}", ""]
    for medida in MEDIDAS.get(tabla, []):
        dax = medida.dax
        # En TMDL la descripción va como comentario /// encima del objeto.
        lineas.append(f"\t/// {medida.descripcion}")
        if "\n" in dax:
            lineas.append(f"\tmeasure '{medida.nombre}' = ```")
            lineas.append(_sangrar(dax, 3))
            lineas.append("\t\t\t```")
        else:
            lineas.append(f"\tmeasure '{medida.nombre}' = {dax}")
        lineas += [
            f"\t\tformatString: {medida.formato}",
            f"\t\tlineageTag: {_id(tabla, 'medida', medida.nombre)}",
            "",
        ]
    for c in COLUMNAS[tabla]:
        lineas += [f"\tcolumn {c.nombre}", f"\t\tdataType: {c.tipo}"]
        if c.formato:
            lineas.append(f"\t\tformatString: {c.formato}")
        if c.oculta:
            lineas.append("\t\tisHidden")
        lineas += [
            f"\t\tlineageTag: {_id(tabla, c.nombre)}",
            "\t\tsummarizeBy: none",
            f"\t\tsourceColumn: {c.nombre}",
        ]
        if c.ordenar_por:
            lineas.append(f"\t\tsortByColumn: {c.ordenar_por}")
        lineas.append("")
    lineas += [
        f"\tpartition {tabla} = m",
        "\t\tmode: import",
        "\t\tsource =",
        _sangrar(consulta_m(tabla, COLUMNAS[tabla]), 4),
        "",
        "\tannotation PBI_ResultType = Table",
        "",
    ]
    return "\n".join(lineas)


def escribir_modelo(carpeta: Path) -> None:
    definicion = carpeta / "definition"
    (definicion / "tables").mkdir(parents=True, exist_ok=True)
    _json(
        carpeta / "definition.pbism",
        {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/"
            "semanticModel/definitionProperties/1.0.0/schema.json",
            "version": "4.2",
            "settings": {},
        },
    )
    _texto(definicion / "database.tmdl", "database\n\tcompatibilityLevel: 1600\n")
    _texto(
        definicion / "model.tmdl",
        "\n".join(
            [
                "model Model",
                "\tculture: es-ES",
                "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
                "\tsourceQueryCulture: es-ES",
                "\tdataAccessOptions",
                "\t\tlegacyRedirects",
                "\t\treturnErrorValuesAsNull",
                "",
                *(f"ref table {t}" for t in COLUMNAS),
                "",
            ]
        ),
    )
    _texto(
        definicion / "expressions.tmdl",
        f'expression OrigenDatos = "{ORIGEN_GITHUB}" meta [IsParameterQuery = true, '
        'Type = "Text", IsParameterQueryRequired = true]\n'
        f"\tlineageTag: {_id('OrigenDatos')}\n\n"
        "\tannotation PBI_ResultType = Text\n",
    )
    _texto(
        definicion / "relationships.tmdl",
        "\n".join(
            f"relationship {_id('relacion', desde, cd)}\n"
            f"\tfromColumn: {desde}.{cd}\n\ttoColumn: {hasta}.{ch}\n"
            for desde, cd, hasta, ch in RELACIONES
        ),
    )
    for tabla in COLUMNAS:
        _texto(definicion / "tables" / f"{tabla}.tmdl", tmdl_tabla(tabla))


# --- informe (PBIR) ----------------------------------------------------------

ESQUEMA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition"


def _columna(tabla: str, nombre: str) -> dict[str, Any]:
    return {
        "Column": {"Expression": {"SourceRef": {"Entity": tabla}}, "Property": nombre}
    }


def _medida(tabla: str, nombre: str) -> dict[str, Any]:
    return {
        "Measure": {"Expression": {"SourceRef": {"Entity": tabla}}, "Property": nombre}
    }


def _proyeccion(campo: dict[str, Any]) -> dict[str, Any]:
    clave = next(iter(campo))
    tabla = campo[clave]["Expression"]["SourceRef"]["Entity"]
    nombre = campo[clave]["Property"]
    return {"field": campo, "queryRef": f"{tabla}.{nombre}", "nativeQueryRef": nombre}


def _literal(valor: str) -> dict[str, Any]:
    return {"expr": {"Literal": {"Value": valor}}}


@dataclass
class Visual:
    nombre: str
    tipo: str
    x: int
    y: int
    ancho: int
    alto: int
    roles: dict[str, list[dict[str, Any]]]
    titulo: str
    orden: dict[str, Any] | None = None
    objetos: dict[str, Any] | None = None

    def json(self, z: int) -> dict[str, Any]:
        consulta: dict[str, Any] = {
            "queryState": {
                rol: {"projections": [_proyeccion(c) for c in campos]}
                for rol, campos in self.roles.items()
            }
        }
        if self.orden:
            consulta["sortDefinition"] = {"sort": [self.orden], "isDefaultSort": False}
        visual: dict[str, Any] = {
            "visualType": self.tipo,
            "query": consulta,
            "visualContainerObjects": {
                "title": [
                    {
                        "properties": {
                            "show": _literal("true"),
                            "text": _literal(f"'{self.titulo}'"),
                        }
                    }
                ]
            },
            "drillFilterOtherVisuals": True,
        }
        if self.objetos:
            visual["objects"] = self.objetos
        return {
            "$schema": f"{ESQUEMA}/visualContainer/1.4.0/schema.json",
            "name": self.nombre,
            "position": {
                "x": self.x,
                "y": self.y,
                "z": z,
                "width": self.ancho,
                "height": self.alto,
                "tabOrder": z,
            },
            "visual": visual,
        }


def _segmentador(nombre: str, x: int, campo: dict[str, Any], titulo: str) -> Visual:
    desplegable = {"data": [{"properties": {"mode": _literal("'Dropdown'")}}]}
    return Visual(
        nombre,
        "slicer",
        x,
        16,
        300,
        64,
        {"Values": [campo]},
        titulo,
        objetos=desplegable,
    )


def _tarjeta(nombre: str, x: int, y: int, campo: dict[str, Any], titulo: str) -> Visual:
    return Visual(nombre, "card", x, y, 290, 120, {"Values": [campo]}, titulo)


def _descendente(campo: dict[str, Any]) -> dict[str, Any]:
    return {"field": campo, "direction": "Descending"}


def _ascendente(campo: dict[str, Any]) -> dict[str, Any]:
    return {"field": campo, "direction": "Ascending"}


def paginas() -> list[tuple[str, str, list[Visual]]]:
    genero = _columna("juegos", "genero_principal")
    banda = _columna("juegos", "banda_precio")
    lectura = _columna("lecturas", "lectura")
    mediana = _medida("juegos", "Mediana reseñas 30 días")
    escala_log = {
        eje: [{"properties": {"axisScale": _literal("'log'")}}]
        for eje in ("categoryAxis", "valueAxis")
    }
    return [
        (
            "mercado",
            "Mercado",
            [
                _segmentador("mercado_genero", 16, genero, "Género"),
                _segmentador("mercado_precio", 332, banda, "Precio"),
                _tarjeta(
                    "mercado_aptos",
                    16,
                    96,
                    _medida("juegos", "Lanzamientos aptos"),
                    "Lanzamientos analizados",
                ),
                _tarjeta(
                    "mercado_mediana", 322, 96, mediana, "Reseñas a 30 días (mediana)"
                ),
                _tarjeta(
                    "mercado_positivas",
                    628,
                    96,
                    _medida("juegos", "Mediana positivas 7 días"),
                    "Positivas la primera semana",
                ),
                _tarjeta(
                    "mercado_excluidos",
                    934,
                    96,
                    _medida("juegos", "% excluidos"),
                    "Excluidos en la limpieza",
                ),
                Visual(
                    "mercado_por_mes",
                    "clusteredColumnChart",
                    16,
                    232,
                    1248,
                    220,
                    {
                        "Category": [_columna("calendario", "mes")],
                        "Y": [_medida("juegos", "Lanzamientos aptos")],
                    },
                    "Lanzamientos por mes",
                    orden=_ascendente(_columna("calendario", "mes")),
                ),
                Visual(
                    "mercado_por_genero",
                    "clusteredBarChart",
                    16,
                    468,
                    616,
                    236,
                    {"Category": [genero], "Y": [mediana]},
                    "Reseñas a 30 días por género (mediana)",
                    orden=_descendente(mediana),
                ),
                Visual(
                    "mercado_por_precio",
                    "clusteredColumnChart",
                    648,
                    468,
                    616,
                    236,
                    {"Category": [banda], "Y": [mediana]},
                    "Reseñas a 30 días por precio (mediana)",
                    orden=_ascendente(banda),
                ),
            ],
        ),
        (
            "ritmo",
            "Ritmo del primer mes",
            [
                _segmentador("ritmo_genero", 16, genero, "Género"),
                _segmentador("ritmo_precio", 332, banda, "Precio"),
                *(
                    _tarjeta(
                        f"ritmo_dia_{d}",
                        16 + i * 306,
                        96,
                        _medida("curva_diaria", f"Recibido día {d}"),
                        f"Del mes ya recibido el día {d}",
                    )
                    for i, d in enumerate(config.DIAS_LECTURA)
                ),
                Visual(
                    "ritmo_curva",
                    "lineChart",
                    16,
                    232,
                    1248,
                    472,
                    {
                        "Category": [_columna("curva_diaria", "dia")],
                        "Y": [_medida("curva_diaria", "% del mes recibido")],
                    },
                    "Parte de las reseñas del primer mes que ya ha llegado, día a día (juego mediano)",
                    orden=_ascendente(_columna("curva_diaria", "dia")),
                ),
            ],
        ),
        (
            "modelo",
            "Calidad del modelo",
            [
                _segmentador(
                    "modelo_lectura", 16, lectura, "Lectura (día 7 si no eliges)"
                ),
                _tarjeta(
                    "modelo_test",
                    16,
                    96,
                    _medida("predicciones", "Juegos de test"),
                    "Juegos de test",
                ),
                _tarjeta(
                    "modelo_factor",
                    322,
                    96,
                    _medida("predicciones", "Factor de error típico"),
                    "Factor de error típico",
                ),
                _tarjeta(
                    "modelo_cobertura",
                    628,
                    96,
                    _medida("predicciones", "Cobertura del rango"),
                    "Aciertos del rango del 90 %",
                ),
                _tarjeta(
                    "modelo_x2",
                    934,
                    96,
                    _medida("predicciones", "Dentro de x2"),
                    "Entre la mitad y el doble",
                ),
                Visual(
                    "modelo_dispersion",
                    "scatterChart",
                    16,
                    232,
                    760,
                    472,
                    {
                        "Category": [_columna("juegos", "nombre")],
                        "X": [_medida("predicciones", "Estimación")],
                        "Y": [_medida("predicciones", "Reseñas reales")],
                    },
                    "Estimación frente a lo que pasó (escala logarítmica)",
                    objetos=escala_log,
                ),
                Visual(
                    "modelo_candidatos",
                    "clusteredBarChart",
                    792,
                    232,
                    472,
                    472,
                    {
                        "Category": [_columna("metricas", "modelo")],
                        "Y": [_medida("metricas", "Factor de error en test")],
                    },
                    "Factor de error de cada candidato en test (menos es mejor)",
                    orden=_ascendente(_medida("metricas", "Factor de error en test")),
                ),
            ],
        ),
        (
            "detalle",
            "Detalle por juego",
            [
                _segmentador("detalle_genero", 16, genero, "Género"),
                _segmentador("detalle_lectura", 332, lectura, "Lectura"),
                Visual(
                    "detalle_tabla",
                    "tableEx",
                    16,
                    96,
                    1248,
                    608,
                    {
                        "Values": [
                            _columna("juegos", "nombre"),
                            _columna("juegos", "genero_principal"),
                            _columna("lecturas", "lectura"),
                            _columna("predicciones", "resenas_lectura"),
                            _columna("predicciones", "estimacion"),
                            _columna("predicciones", "rango_inferior"),
                            _columna("predicciones", "rango_superior"),
                            _columna("predicciones", "resenas_30d_reales"),
                            _columna("predicciones", "dentro_rango"),
                        ]
                    },
                    "Juegos de test: lo que estimó el radar y lo que pasó (dentro_rango = 1 si acertó)",
                ),
            ],
        ),
    ]


def escribir_informe(carpeta: Path) -> None:
    definicion = carpeta / "definition"
    _json(
        carpeta / "definition.pbir",
        {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/"
            "definitionProperties/2.0.0/schema.json",
            "version": "4.0",
            "datasetReference": {"byPath": {"path": f"../{NOMBRE}.SemanticModel"}},
        },
    )
    _json(
        definicion / "version.json",
        {"$schema": f"{ESQUEMA}/versionMetadata/1.0.0/schema.json", "version": "2.0.0"},
    )
    _json(
        definicion / "report.json",
        {
            "$schema": f"{ESQUEMA}/report/1.2.0/schema.json",
            "themeCollection": {},
            "layoutOptimization": "None",
        },
    )
    lista = paginas()
    _json(
        definicion / "pages" / "pages.json",
        {
            "$schema": f"{ESQUEMA}/pagesMetadata/1.0.0/schema.json",
            "pageOrder": [nombre for nombre, _, _ in lista],
            "activePageName": lista[0][0],
        },
    )
    for nombre, titulo, visuales in lista:
        carpeta_pagina = definicion / "pages" / nombre
        _json(
            carpeta_pagina / "page.json",
            {
                "$schema": f"{ESQUEMA}/page/1.3.0/schema.json",
                "name": nombre,
                "displayName": titulo,
                "displayOption": "FitToPage",
                "height": 720,
                "width": 1280,
            },
        )
        for z, visual in enumerate(visuales):
            _json(
                carpeta_pagina / "visuals" / visual.nombre / "visual.json",
                visual.json(z),
            )


# --- proyecto ----------------------------------------------------------------


def _json(ruta: Path, contenido: Any) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(
        json.dumps(contenido, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _texto(ruta: Path, contenido: str) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(contenido, encoding="utf-8", newline="\n")


def escribir_proyecto(carpeta: Path) -> None:
    for parte in ("Report", "SemanticModel"):
        destino = carpeta / f"{NOMBRE}.{parte}"
        # Se regenera entero, salvo la configuración local de Power BI Desktop.
        if destino.exists():
            for hijo in destino.iterdir():
                if hijo.name != ".pbi":
                    shutil.rmtree(hijo) if hijo.is_dir() else hijo.unlink()
    _json(
        carpeta / f"{NOMBRE}.pbip",
        {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/pbip/"
            "pbipProperties/1.0.0/schema.json",
            "version": "1.0",
            "artifacts": [{"report": {"path": f"{NOMBRE}.Report"}}],
            "settings": {"enableAutoRecovery": True},
        },
    )
    escribir_modelo(carpeta / f"{NOMBRE}.SemanticModel")
    escribir_informe(carpeta / f"{NOMBRE}.Report")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    escribir_datos(DIR_POWERBI / "datos")
    escribir_proyecto(DIR_POWERBI)
    logger.info("Proyecto escrito en %s", DIR_POWERBI / f"{NOMBRE}.pbip")


if __name__ == "__main__":
    main()
