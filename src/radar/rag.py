"""Índice del asistente (RAG): fragmentos de texto y sus embeddings.

El asistente de la app responde con lo que recupera de dos fuentes:

- la documentación del proyecto: el README y las celdas de texto de los
  notebooks, cortadas por secciones;
- una ficha por juego descargado, escrita a partir de las tablas procesadas.

Cada fragmento se convierte en un vector con un modelo de embeddings de
Ollama. Los vectores se normalizan y se guardan cuantizados a int8 en base64:
así el índice de unos 4.000 fragmentos pesa unos pocos MB y la app calcula el
coseno como un producto escalar, sin dependencias.

Sin Ollama (o con `--sin-embeddings`) se escribe el índice solo con texto y
la app recupera únicamente por palabras (BM25).

Uso:
    python -m radar.rag
    python -m radar.rag --sin-embeddings
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests

from radar import config

logger = logging.getLogger("radar.rag")

RUTA_INDICE = config.DIR_APP_DATOS / "rag.json"
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
MODELO_EMBEDDINGS = os.getenv("OLLAMA_EMBEDDINGS", "embeddinggemma")
# Prefijos con los que se entrenó embeddinggemma para búsqueda: la consulta y
# el documento no se codifican igual. La app usa los mismos (van en el JSON).
PREFIJO_CONSULTA = "task: search result | query: "
PREFIJO_DOCUMENTO = "title: {titulo} | text: "
LOTE = 64
MAX_CARACTERES = 1400  # unas 350 palabras: cabe de sobra en el contexto del modelo

# Secciones del README que no aportan nada a una pregunta sobre el proyecto.
SECCIONES_EXCLUIDAS = {"Convención de commits", "Licencia"}

ESTADOS = {
    "apto": "apto, entra en la muestra analizada",
    "sin_resenas_en_30d": (
        "excluido, no entra en la muestra analizada ni en el entrenamiento porque "
        "no tuvo ninguna reseña en inglés en su primer mes"
    ),
    "fase_previa_publica": (
        "excluido, no entra en la muestra analizada ni en el entrenamiento porque "
        "más del 5 % de sus reseñas son anteriores a la fecha oficial (salió de "
        "acceso anticipado)"
    ),
    "sin_precio_usd": (
        "excluido, no entra en la muestra analizada ni en el entrenamiento porque "
        "no tiene precio en dólares"
    ),
}


# --- documentación -----------------------------------------------------------


def _trocear(titulo: str, texto: str) -> list[str]:
    """Corta una sección larga por párrafos sin pasar de MAX_CARACTERES."""
    # Las tablas alineadas por Prettier llevan columnas de espacios y guiones
    # que solo gastan contexto.
    texto = re.sub(r"-{4,}", "---", re.sub(r" {2,}", " ", texto))
    trozos, actual = [], ""
    for parrafo in re.split(r"\n\s*\n", texto.strip()):
        if actual and len(actual) + len(parrafo) > MAX_CARACTERES:
            trozos.append(actual)
            actual = ""
        actual = f"{actual}\n\n{parrafo}" if actual else parrafo
    if actual:
        trozos.append(actual)
    return [f"{titulo}\n\n{t}" for t in trozos]


def _secciones_markdown(texto: str, nivel_max: int = 3) -> list[tuple[str, str]]:
    """Divide un Markdown en (título, cuerpo) por encabezados de nivel 2 y 3."""
    patron = re.compile(rf"^(#{{2,{nivel_max}}})\s+(.+)$", re.MULTILINE)
    marcas = list(patron.finditer(texto))
    secciones = []
    for i, marca in enumerate(marcas):
        fin = marcas[i + 1].start() if i + 1 < len(marcas) else len(texto)
        cuerpo = texto[marca.end() : fin].strip()
        if cuerpo:
            secciones.append((marca.group(2).strip(), cuerpo))
    return secciones


def fragmentos_readme(ruta: Path) -> list[dict[str, Any]]:
    fragmentos = []
    for titulo, cuerpo in _secciones_markdown(ruta.read_text(encoding="utf-8")):
        nombre = re.sub(r"^\d+\.\s*", "", titulo)
        if nombre in SECCIONES_EXCLUIDAS:
            continue
        for i, texto in enumerate(_trocear(f"README · {titulo}", cuerpo)):
            fragmentos.append(
                {
                    "id": f"readme-{len(fragmentos)}",
                    "tipo": "documentacion",
                    "titulo": f"README · {titulo}" + (f" ({i + 1})" if i else ""),
                    "texto": texto,
                }
            )
    return fragmentos


def fragmentos_notebook(ruta: Path) -> list[dict[str, Any]]:
    """Agrupa las celdas de texto de cada sección del notebook (las conclusiones)."""
    celdas = json.loads(ruta.read_text(encoding="utf-8"))["cells"]
    texto = "\n\n".join(
        "".join(c["source"]) for c in celdas if c["cell_type"] == "markdown"
    )
    nombre = ruta.stem
    fragmentos = []
    for titulo, cuerpo in _secciones_markdown(texto, nivel_max=2):
        for i, trozo in enumerate(_trocear(f"Notebook {nombre} · {titulo}", cuerpo)):
            fragmentos.append(
                {
                    "id": f"{nombre}-{len(fragmentos)}",
                    "tipo": "documentacion",
                    "titulo": f"Notebook {nombre} · {titulo}"
                    + (f" ({i + 1})" if i else ""),
                    "texto": trozo,
                }
            )
    return fragmentos


# --- fichas de juegos --------------------------------------------------------


def _pct(valor: float) -> str:
    return f"{valor * 100:.0f} %".replace(".", ",")


def _usd(valor: float) -> str:
    return "gratis" if valor == 0 else f"{valor:.2f} $".replace(".", ",")


def ficha(juego: pd.Series, lecturas: pd.Series | None, en_test: bool) -> str:
    """Texto de un juego con las cifras que alguien preguntaría sobre él.

    Evita las palabras de la documentación («modelo», «radar», «día»): las
    fichas son cortas y, si las repitieran, BM25 las pondría por delante de la
    documentación en las preguntas generales.
    """
    lineas = [
        f"{juego['nombre']} (appid {juego['appid']}) se lanzó en Steam el "
        f"{juego['fecha_lanzamiento']}.",
        f"Precio: {_usd(juego['precio_usd'])}. Género principal: "
        f"{juego['genero_principal']}. Géneros: {str(juego['generos']).replace('|', ', ')}.",
        f"Desarrollador: {juego['desarrollador']}. Editor: {juego['editor']}.",
        f"Estado: {ESTADOS.get(juego['estado'], juego['estado'])}.",
    ]
    if lecturas is not None:
        resenas = [
            f"{int(lecturas[f'resenas_{dia}d'])} a los {dia} días"
            for dia in config.DIAS_LECTURA
        ]
        lineas.append(
            f"Reseñas en inglés acumuladas: {', '.join(resenas)} y "
            f"{int(lecturas['resenas_30d'])} a los 30 días."
        )
        positivas = [
            f"{_pct(lecturas[f'pct_positivas_{dia}d'])} a los {dia} días"
            for dia in config.DIAS_LECTURA
            if pd.notna(lecturas[f"pct_positivas_{dia}d"])
        ]
        if positivas:
            lineas.append(f"Reseñas positivas: {', '.join(positivas)}.")
    elif pd.notna(juego["resenas_30d"]):
        lineas.append(
            f"Reseñas en inglés en sus primeros 30 días: {int(juego['resenas_30d'])}."
        )
    if en_test:
        lineas.append(
            "Está en el conjunto de test (no se usó para entrenar). "
            f"Enlace para probarlo: /?juego={juego['appid']}"
        )
    return "\n".join(lineas)


def fragmentos_juegos(
    juegos: pd.DataFrame, dataset: pd.DataFrame, appids_test: set[int]
) -> list[dict[str, Any]]:
    lecturas = dataset.set_index("appid")
    fragmentos = []
    for _, juego in juegos.iterrows():
        appid = int(juego["appid"])
        fila = lecturas.loc[appid] if appid in lecturas.index else None
        fragmentos.append(
            {
                "id": f"juego-{appid}",
                "tipo": "juego",
                "titulo": str(juego["nombre"]),
                "texto": ficha(juego, fila, appid in appids_test),
                "appid": appid,
            }
        )
    return fragmentos


def construir_corpus(raiz: Path = config.RAIZ) -> list[dict[str, Any]]:
    procesado = raiz / "data" / "processed"
    juegos = pd.read_csv(procesado / "juegos.csv")
    dataset = pd.read_csv(procesado / "dataset_radar.csv")
    radar = json.loads((raiz / "app" / "data" / "radar.json").read_text("utf-8"))
    appids_test = {e["appid"] for e in radar["ejemplos"]}

    corpus = fragmentos_readme(raiz / "README.md")
    for notebook in sorted((raiz / "notebooks").glob("*.ipynb")):
        corpus += fragmentos_notebook(notebook)
    corpus += fragmentos_juegos(juegos, dataset, appids_test)
    return corpus


# --- embeddings --------------------------------------------------------------


def embeddings(textos: list[str], sesion: requests.Session) -> np.ndarray:
    vectores = []
    for inicio in range(0, len(textos), LOTE):
        lote = textos[inicio : inicio + LOTE]
        r = sesion.post(
            f"{OLLAMA_HOST}/api/embed",
            json={"model": MODELO_EMBEDDINGS, "input": lote},
            timeout=300,
        )
        r.raise_for_status()
        vectores += r.json()["embeddings"]
        logger.info("Embeddings: %d / %d", len(vectores), len(textos))
    return np.asarray(vectores, dtype=np.float32)


def cuantizar(vectores: np.ndarray) -> str:
    """Normaliza a norma 1 y guarda cada componente como int8 (× 127)."""
    normas = np.linalg.norm(vectores, axis=1, keepdims=True)
    unitarios = vectores / np.where(normas == 0, 1, normas)
    enteros = np.clip(np.round(unitarios * 127), -127, 127).astype(np.int8)
    return base64.b64encode(enteros.tobytes()).decode("ascii")


def texto_documento(fragmento: dict[str, Any]) -> str:
    titulo = fragmento["titulo"] if fragmento["tipo"] == "juego" else "none"
    return PREFIJO_DOCUMENTO.format(titulo=titulo) + fragmento["texto"]


def construir_indice(con_embeddings: bool = True) -> dict[str, Any]:
    corpus = construir_corpus()
    indice: dict[str, Any] = {
        "generado_en": datetime.now(UTC).isoformat(timespec="seconds"),
        "fragmentos": corpus,
        "embeddings": None,
    }
    if con_embeddings:
        with requests.Session() as sesion:
            vectores = embeddings([texto_documento(f) for f in corpus], sesion)
        indice["embeddings"] = {
            "modelo": MODELO_EMBEDDINGS,
            "dimension": int(vectores.shape[1]),
            "prefijo_consulta": PREFIJO_CONSULTA,
            "datos": cuantizar(vectores),
        }
    return indice


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--sin-embeddings",
        action="store_true",
        help="escribe solo el texto (la app recuperará por palabras)",
    )
    args = parser.parse_args()
    indice = construir_indice(con_embeddings=not args.sin_embeddings)
    RUTA_INDICE.write_text(
        json.dumps(indice, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    logger.info(
        "Escrito %s: %d fragmentos (%.1f MB)",
        RUTA_INDICE.name,
        len(indice["fragmentos"]),
        RUTA_INDICE.stat().st_size / 1e6,
    )


if __name__ == "__main__":
    main()
