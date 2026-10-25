// Evaluación del asistente con Ollama en marcha (npm run evaluar-asistente).
//
// 1. Recuperación: con cada pregunta de tests/preguntas_asistente.json mira si
//    alguna de sus fuentes esperadas sale primero (acierto@1) o entre los seis
//    fragmentos que se pasan al modelo (acierto@6), con tres búsquedas: por
//    palabras (la de la versión publicada, donde no hay embeddings), por
//    embeddings e híbrida (la de la app en local).
// 2. Respuestas: si contienen el dato esperado, si citan fuentes y si
//    reconocen que no saben cuando la pregunta queda fuera del proyecto.
//
// Las preguntas «reformuladas» evitan las palabras de la documentación. Las de
// «reserva» se escribieron después de ajustar la búsqueda con las demás: miden
// si las decisiones generalizan o solo encajan con las preguntas de ajuste.
//
// Escribe el resultado en ../docs/evaluacion_asistente.md.
import { readFileSync, writeFileSync } from "node:fs";

import { construirPrompt } from "../src/lib/asistente.ts";
import { chat, CONFIG, embeddingConsulta } from "../src/lib/ollama.ts";
import { Buscador, esFuenteEsperada, type IndiceRag, type ModoBusqueda } from "../src/lib/rag.ts";

interface Pregunta {
  pregunta: string;
  fuentes?: string[];
  contiene?: string[];
  reformulada?: boolean;
  reserva?: boolean;
  fuera_de_alcance?: boolean;
}

type Modo = ModoBusqueda;

const K = 6;
const NO_SABE = [
  "no tengo",
  "no contienen",
  "no contiene",
  "no aparece",
  "no dispongo",
  "no se menciona",
  "no puedo",
  "no hay información",
  "no incluyen",
  "no se indica",
  "no figura",
  "no proporcionan",
  "no es posible",
  "no se puede",
];

const indice: IndiceRag = JSON.parse(readFileSync("data/rag.json", "utf-8"));
const preguntas: Pregunta[] = JSON.parse(readFileSync("tests/preguntas_asistente.json", "utf-8"));
const buscador = new Buscador(indice);
if (!indice.embeddings)
  throw new Error("El índice no tiene embeddings: ejecuta python -m radar.rag");
const { modelo, prefijo_consulta } = indice.embeddings;

const vectores = new Map<Pregunta, number[]>();
for (const p of preguntas) {
  const v = await embeddingConsulta(prefijo_consulta + p.pregunta, modelo);
  if (!v) throw new Error(`Sin respuesta de ${CONFIG.host} para los embeddings (${modelo})`);
  vectores.set(p, v);
}

function buscar(p: Pregunta, modo: Modo) {
  return buscador.buscar(p.pregunta, vectores.get(p)!, K, modo).resultados;
}

const nombres: Record<Modo, string> = {
  lexica: "Palabras (BM25)",
  semantica: `Embeddings (${modelo})`,
  hibrida: "Híbrida (RRF)",
};
const grupos: [string, Pregunta[]][] = [
  ["Ajuste · directas", preguntas.filter((p) => p.fuentes && !p.reserva && !p.reformulada)],
  ["Ajuste · reformuladas", preguntas.filter((p) => p.fuentes && !p.reserva && p.reformulada)],
  ["Reserva · directas", preguntas.filter((p) => p.fuentes && p.reserva && !p.reformulada)],
  ["Reserva · reformuladas", preguntas.filter((p) => p.fuentes && p.reserva && p.reformulada)],
];
const fuera = preguntas.filter((p) => p.fuera_de_alcance);
const modos: Modo[] = ["lexica", "semantica", "hibrida"];

// --- recuperación -------------------------------------------------------------
function acierto6(grupo: Pregunta[], modo: Modo) {
  const n = grupo.filter((p) =>
    buscar(p, modo).some((r) => esFuenteEsperada(r.fragmento, p.fuentes!)),
  ).length;
  return `${n}/${grupo.length}`;
}
const tablaRecuperacion = modos
  .map((m) => `| ${nombres[m]} | ${grupos.map(([, g]) => acierto6(g, m)).join(" | ")} |`)
  .join("\n");

// --- respuestas ----------------------------------------------------------------
const NO_RESPONDE = new Set<Modo>(["semantica"]);
async function responder(modo: Modo) {
  const ok = new Map<Pregunta, boolean>();
  const textos = new Map<Pregunta, string>();
  let citadas = 0;
  let tiempo = 0;
  for (const p of preguntas) {
    const inicio = performance.now();
    let respuesta = "";
    const mensajes = [{ rol: "usuario" as const, texto: p.pregunta }];
    for await (const trozo of chat(construirPrompt(mensajes, buscar(p, modo)))) respuesta += trozo;
    tiempo += performance.now() - inicio;
    const minusculas = respuesta.toLowerCase();
    const bien = p.fuera_de_alcance
      ? NO_SABE.some((f) => minusculas.includes(f))
      : p.contiene!.some((c) => minusculas.includes(c.toLowerCase()));
    if (!p.fuera_de_alcance && /\[\d+\]|【\d+/.test(respuesta)) citadas++;
    ok.set(p, bien);
    textos.set(p, respuesta);
    console.log(`${modo.padEnd(9)} ${bien ? "ok   " : "FALLO"} ${p.pregunta}`);
  }
  const cuenta = (g: Pregunta[]) => `${g.filter((p) => ok.get(p)).length}/${g.length}`;
  return { ok, textos, cuenta, citadas, tiempo: tiempo / preguntas.length / 1000 };
}

const respuestas = new Map<Modo, Awaited<ReturnType<typeof responder>>>();
for (const m of modos) if (!NO_RESPONDE.has(m)) respuestas.set(m, await responder(m));
const modosRespuesta = modos.filter((m) => !NO_RESPONDE.has(m));
const dentro = preguntas.filter((p) => !p.fuera_de_alcance);

const filasRespuesta = [
  ...grupos.map(
    ([nombre, g]) =>
      `| ${nombre} | ${modosRespuesta.map((m) => respuestas.get(m)!.cuenta(g)).join(" | ")} |`,
  ),
  `| Ajenas al proyecto rechazadas | ${modosRespuesta.map((m) => respuestas.get(m)!.cuenta(fuera)).join(" | ")} |`,
  `| Respuestas que citan una fuente | ${modosRespuesta.map((m) => `${respuestas.get(m)!.citadas}/${dentro.length}`).join(" | ")} |`,
  `| Tiempo medio de respuesta | ${modosRespuesta.map((m) => `${respuestas.get(m)!.tiempo.toFixed(1)} s`).join(" | ")} |`,
].join("\n");

const marca = (v: boolean | undefined) => (v ? "✓" : "✗");
const celda = (t: string | undefined) =>
  (t ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 180);
const hibrida = respuestas.get("hibrida")!;
const lexica = respuestas.get("lexica")!;

const informe = `# Evaluación del asistente

Generado con \`npm run evaluar-asistente\` el ${new Date().toISOString().slice(0, 10)}.
Modelo de lenguaje: \`${CONFIG.modelo}\`; embeddings: \`${modelo}\`; índice de
${indice.fragmentos.length} fragmentos. ${preguntas.length} preguntas de referencia
(\`app/tests/preguntas_asistente.json\`). Las de **ajuste** se usaron para decidir cómo
busca el asistente; las de **reserva** se escribieron después y no intervinieron en esas
decisiones, así que miden si generalizan. Las **reformuladas** evitan las palabras de la
documentación. ${fuera.length} preguntas son ajenas al proyecto.

La versión local usa la búsqueda híbrida; la publicada en Vercel no tiene embeddings
(Ollama Cloud no los ofrece) y busca solo por palabras.

Se probó también ampliar esa búsqueda con palabras clave que escribe el modelo de
lenguaje antes de buscar (fusionando la búsqueda de la pregunta y la de las claves).
No mejoró el resultado neto: ayudaba algo con las preguntas reformuladas y empeoraba
algo las directas, dentro de la variación entre ejecuciones. Se descartó porque añade
una llamada al modelo por pregunta sin una mejora medible.

## Recuperación: la fuente esperada está entre los ${K} fragmentos

| Búsqueda | ${grupos.map(([n]) => n).join(" | ")} |
| --- | ${grupos.map(() => "---").join(" | ")} |
${tablaRecuperacion}

## Respuestas con el dato esperado

| Grupo | ${modosRespuesta.map((m) => nombres[m]).join(" | ")} |
| --- | ${modosRespuesta.map(() => "---").join(" | ")} |
${filasRespuesta}

La comprobación es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guardan las respuestas:

| Híbrida | Palabras | Pregunta | Respuesta (solo palabras, la de la versión publicada) |
| --- | --- | --- | --- |
${preguntas.map((p) => `| ${marca(hibrida.ok.get(p))} | ${marca(lexica.ok.get(p))} | ${p.reserva ? "(reserva) " : ""}${p.pregunta} | ${celda(lexica.textos.get(p))} |`).join("\n")}
`;
writeFileSync("../docs/evaluacion_asistente.md", informe, "utf-8");
console.log("\n" + informe.split("La comprobación")[0]);
