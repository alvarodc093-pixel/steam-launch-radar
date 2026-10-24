"""El índice del asistente: troceado, fichas, cuantización y escritura."""

from __future__ import annotations

import base64
import json
import sys

import numpy as np
import pandas as pd
import pytest
import responses

from radar import rag


def test_secciones_y_troceado():
    texto = (
        "# Título\n\nintro\n\n## Uno\n\nA\n\n### Dos\n\nB\n\n## Vacía\n\n## Tres\n\nC"
    )
    secciones = rag._secciones_markdown(texto)
    assert [t for t, _ in secciones] == ["Uno", "Dos", "Tres"]

    largo = "\n\n".join(["palabra " * 60] * 6)  # unos 2.900 caracteres
    trozos = rag._trocear("Sección", largo)
    assert len(trozos) > 1
    assert all(t.startswith("Sección\n\n") for t in trozos)
    assert all(len(t) <= rag.MAX_CARACTERES + 500 for t in trozos)


def test_las_tablas_se_compactan():
    tabla = "| a      | b      |\n| ------ | ------ |\n| 1      | 2      |"
    (trozo,) = rag._trocear("T", tabla)
    assert "  " not in trozo
    assert "------" not in trozo


def _juego(**cambios):
    base = {
        "appid": 10,
        "nombre": "Juego",
        "fecha_lanzamiento": "2026-01-02",
        "precio_usd": 9.99,
        "genero_principal": "Action",
        "generos": "Action|Indie",
        "desarrollador": "Estudio",
        "editor": "Editor",
        "estado": "apto",
        "resenas_30d": 120,
    }
    return pd.Series({**base, **cambios})


def test_ficha_con_lecturas_y_en_test():
    lecturas = pd.Series(
        {
            "resenas_3d": 10,
            "pct_positivas_3d": 0.9,
            "resenas_7d": 30,
            "pct_positivas_7d": np.nan,
            "resenas_14d": 60,
            "pct_positivas_14d": 0.8,
            "resenas_30d": 120,
        }
    )
    texto = rag.ficha(_juego(), lecturas, en_test=True)
    assert "9,99 $" in texto
    assert "Action, Indie" in texto
    assert "día 3: 10 (90 % positivas)" in texto
    assert "día 7: 30;" in texto  # sin porcentaje si no lo hay
    assert "día 30: 120" in texto
    assert "/?juego=10&dia=7" in texto


def test_ficha_de_un_excluido():
    texto = rag.ficha(
        _juego(precio_usd=0.0, estado="sin_resenas_en_30d", resenas_30d=0), None, False
    )
    assert "gratis" in texto
    assert "ninguna reseña en inglés" in texto
    assert "primeros 30 días: 0" in texto
    assert "conjunto de test" not in texto


def test_cuantizar_conserva_el_coseno():
    rng = np.random.default_rng(0)
    vectores = rng.normal(size=(5, 32)).astype(np.float32)
    enteros = np.frombuffer(base64.b64decode(rag.cuantizar(vectores)), dtype=np.int8)
    enteros = enteros.reshape(5, 32).astype(float) / 127
    unitarios = vectores / np.linalg.norm(vectores, axis=1, keepdims=True)
    assert np.allclose(enteros @ enteros.T, unitarios @ unitarios.T, atol=0.03)


def test_corpus_del_repositorio():
    corpus = rag.construir_corpus()
    tipos = {f["tipo"] for f in corpus}
    assert tipos == {"documentacion", "juego"}
    assert len({f["id"] for f in corpus}) == len(corpus)
    titulos = " ".join(f["titulo"] for f in corpus)
    assert "Licencia" not in titulos
    assert "Notebook 02_eda" in titulos


@responses.activate
def test_indice_con_embeddings(monkeypatch):
    corpus = [
        {"id": "a", "tipo": "documentacion", "titulo": "A", "texto": "uno"},
        {"id": "b", "tipo": "juego", "titulo": "B", "texto": "dos", "appid": 1},
    ]
    monkeypatch.setattr(rag, "construir_corpus", lambda: corpus)
    responses.post(
        f"{rag.OLLAMA_HOST}/api/embed",
        json={"embeddings": [[1.0, 0.0, 0.0], [0.0, 2.0, 0.0]]},
    )
    indice = rag.construir_indice()
    enviado = json.loads(responses.calls[0].request.body)
    assert enviado["input"] == ["title: none | text: uno", "title: B | text: dos"]
    assert indice["embeddings"]["dimension"] == 3
    assert indice["embeddings"]["prefijo_consulta"] == rag.PREFIJO_CONSULTA


def test_main_sin_embeddings(monkeypatch, tmp_path):
    ruta = tmp_path / "rag.json"
    monkeypatch.setattr(rag, "RUTA_INDICE", ruta)
    monkeypatch.setattr(
        rag,
        "construir_corpus",
        lambda: [{"id": "a", "tipo": "documentacion", "titulo": "A", "texto": "x"}],
    )
    monkeypatch.setattr(sys, "argv", ["rag", "--sin-embeddings"])
    rag.main()
    indice = json.loads(ruta.read_text(encoding="utf-8"))
    assert indice["embeddings"] is None
    assert len(indice["fragmentos"]) == 1


@responses.activate
def test_error_de_ollama_se_propaga(monkeypatch):
    monkeypatch.setattr(
        rag,
        "construir_corpus",
        lambda: [{"id": "a", "tipo": "documentacion", "titulo": "A", "texto": "x"}],
    )
    responses.post(f"{rag.OLLAMA_HOST}/api/embed", status=404)
    with pytest.raises(Exception, match="404"):
        rag.construir_indice()
