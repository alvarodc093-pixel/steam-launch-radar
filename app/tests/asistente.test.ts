import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  consultaDeBusqueda,
  construirPrompt,
  Limitador,
  validarConversacion,
} from "../src/lib/asistente.ts";
import { Buscador, esFuenteEsperada, fusionar, tokenizar, type IndiceRag } from "../src/lib/rag.ts";

const leer = async <T>(ruta: string): Promise<T> => JSON.parse(await readFile(ruta, "utf-8"));

test("tokenizar quita tildes, mayúsculas y palabras vacías", () => {
  assert.deepEqual(tokenizar("¿Cuántas reseñas tuvo el juego?"), [
    "cuantas",
    "resenas",
    "tuvo",
    "juego",
  ]);
  assert.deepEqual(tokenizar("appid 2102040"), ["appid", "2102040"]);
});

test("la fusión premia lo que aparece arriba en los dos rankings", () => {
  const total = fusionar([
    [1, 2, 3],
    [3, 1, 4],
  ]);
  const orden = [...total.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  assert.equal(orden[0], 1);
  assert.equal(orden.at(-1), 4);
});

test("validación de la conversación", () => {
  assert.equal(validarConversacion({}).ok, false);
  assert.equal(validarConversacion({ mensajes: [{ rol: "asistente", texto: "hola" }] }).ok, false);
  assert.equal(
    validarConversacion({ mensajes: [{ rol: "usuario", texto: "x".repeat(1001) }] }).ok,
    false,
  );
  assert.equal(validarConversacion({ mensajes: [{ rol: "sistema", texto: "hola" }] }).ok, false);
  const ok = validarConversacion({
    mensajes: [{ rol: "usuario", texto: "  ¿Qué es el radar?  " }],
  });
  assert.ok(ok.ok && ok.valor[0].texto === "¿Qué es el radar?");
});

test("una repregunta corta se busca junto con la pregunta anterior", () => {
  const mensajes = [
    { rol: "usuario" as const, texto: "¿Cuál es el error del radar a día 7?" },
    { rol: "asistente" as const, texto: "×1,21" },
    { rol: "usuario" as const, texto: "¿Y a día 14?" },
  ];
  assert.match(consultaDeBusqueda(mensajes), /error del radar.*día 14/);
  const prompt = construirPrompt(mensajes, []);
  assert.equal(prompt[0].role, "system");
  assert.equal(prompt.at(-1)!.role, "user");
  assert.match(prompt.at(-1)!.content, /¿Y a día 14\?/);
});

test("sin Ollama, la búsqueda por palabras encuentra la fuente esperada", async () => {
  const indice = await leer<IndiceRag>("data/rag.json");
  const preguntas = await leer<{ pregunta: string; fuentes?: string[] }[]>(
    "tests/preguntas_asistente.json",
  );
  const buscador = new Buscador(indice);
  const conFuente = preguntas.filter((p) => p.fuentes);
  const aciertos = conFuente.filter((p) =>
    buscador
      .buscar(p.pregunta, null)
      .resultados.some((r) => esFuenteEsperada(r.fragmento, p.fuentes!)),
  ).length;
  // Umbral por debajo del valor medido (ver docs/evaluacion_asistente.md) para
  // que avise si un cambio en el índice o en la tokenización lo empeora.
  assert.ok(aciertos / conFuente.length >= 0.75, `acierto@6 = ${aciertos}/${conFuente.length}`);
});

test("el limitador corta a partir del máximo y se recupera al pasar la ventana", () => {
  const limitador = new Limitador(2, 1000);
  assert.ok(limitador.permitir("ip", 0));
  assert.ok(limitador.permitir("ip", 10));
  assert.equal(limitador.permitir("ip", 20), false);
  assert.ok(limitador.permitir("otra", 20), "cada IP lleva su propia cuenta");
  assert.ok(limitador.permitir("ip", 1005), "la primera petición ya salió de la ventana");
});
