// Evaluación del asistente con Ollama en marcha (npm run evaluar-asistente).
//
// 1. Recuperación: con cada pregunta de tests/preguntas_asistente.json mira si
//    alguna de sus fuentes esperadas sale primero (acierto@1) o entre los seis
//    fragmentos que se pasan al modelo (acierto@6), y su posición media (MRR),
//    para la búsqueda por palabras, por embeddings y la combinación de ambas.
// 2. Respuestas: en los dos modos con los que funciona la app (híbrida en
//    local, solo palabras en Vercel, donde no hay embeddings), si la respuesta
//    contiene el dato esperado, si cita fuentes y si reconoce que no sabe
//    cuando la pregunta queda fuera del proyecto.
//
// Las preguntas «reformuladas» evitan las palabras de la documentación: miden
// si el asistente entiende la pregunta y no solo si coincide con el texto.
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
  fuera_de_alcance?: boolean;
}

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

const vectores = new Map<string, number[]>();
for (const p of preguntas) {
  const v = await embeddingConsulta(prefijo_consulta + p.pregunta, modelo);
  if (!v) throw new Error(`Sin respuesta de ${CONFIG.host} para los embeddings (${modelo})`);
  vectores.set(p.pregunta, v);
}

const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
const nombres: Record<ModoBusqueda, string> = {
  lexica: "Palabras (BM25)",
  semantica: `Embeddings (${modelo})`,
  hibrida: "Híbrida (RRF)",
};
const dentro = preguntas.filter((p) => !p.fuera_de_alcance);
const fuera = preguntas.filter((p) => p.fuera_de_alcance);
const directas = dentro.filter((p) => !p.reformulada);
const reformuladas = dentro.filter((p) => p.reformulada);

// --- recuperación -------------------------------------------------------------
function recuperacion(grupo: Pregunta[], modo: ModoBusqueda) {
  let a1 = 0;
  let a6 = 0;
  let mrr = 0;
  for (const p of grupo) {
    const { resultados } = buscador.buscar(p.pregunta, vectores.get(p.pregunta)!, K, modo);
    const posicion = resultados.findIndex((r) => esFuenteEsperada(r.fragmento, p.fuentes!));
    if (posicion === 0) a1++;
    if (posicion >= 0) {
      a6++;
      mrr += 1 / (posicion + 1);
    }
  }
  const n = grupo.length;
  return `${pct(a1 / n)} | ${pct(a6 / n)} | ${(mrr / n).toFixed(2)}`;
}

const modos: ModoBusqueda[] = ["lexica", "semantica", "hibrida"];
const tablaRecuperacion = modos
  .map((m) => `| ${nombres[m]} | ${recuperacion(directas, m)} | ${recuperacion(reformuladas, m)} |`)
  .join("\n");

// --- respuestas ----------------------------------------------------------------
async function responder(modo: ModoBusqueda) {
  const ok = new Map<Pregunta, boolean>();
  const textos = new Map<Pregunta, string>();
  let citadas = 0;
  let tiempo = 0;
  for (const p of preguntas) {
    const { resultados } = buscador.buscar(p.pregunta, vectores.get(p.pregunta)!, K, modo);
    const inicio = performance.now();
    let respuesta = "";
    const mensajes = [{ rol: "usuario" as const, texto: p.pregunta }];
    for await (const trozo of chat(construirPrompt(mensajes, resultados))) respuesta += trozo;
    tiempo += performance.now() - inicio;
    const minusculas = respuesta.toLowerCase();
    const bien = p.fuera_de_alcance
      ? NO_SABE.some((f) => minusculas.includes(f))
      : p.contiene!.some((c) => minusculas.includes(c.toLowerCase()));
    if (!p.fuera_de_alcance && /\[\d+\]|【\d+/.test(respuesta)) citadas++;
    ok.set(p, bien);
    textos.set(p, respuesta);
    console.log(`${modo.padEnd(8)} ${bien ? "ok   " : "FALLO"} ${p.pregunta}`);
  }
  const cuenta = (grupo: Pregunta[]) => grupo.filter((p) => ok.get(p)).length;
  return {
    ok,
    textos,
    fila: (grupo: Pregunta[]) =>
      `${cuenta(grupo)} / ${grupo.length} (${pct(cuenta(grupo) / grupo.length)})`,
    citadas,
    tiempo: tiempo / preguntas.length / 1000,
  };
}

const hibrida = await responder("hibrida");
const lexica = await responder("lexica");

const marca = (v: boolean | undefined) => (v ? "✓" : "✗");
const celda = (t: string | undefined) =>
  (t ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 200);

const informe = `# Evaluación del asistente

Generado con \`npm run evaluar-asistente\` el ${new Date().toISOString().slice(0, 10)}.
Modelo de lenguaje: \`${CONFIG.modelo}\`; embeddings: \`${modelo}\`; índice de
${indice.fragmentos.length} fragmentos. ${preguntas.length} preguntas de referencia
(\`app/tests/preguntas_asistente.json\`): ${directas.length} directas, ${reformuladas.length}
reformuladas sin las palabras de la documentación y ${fuera.length} ajenas al proyecto.

## Recuperación

Cada pregunta tiene una o varias secciones que contienen la respuesta.
Acierto@1: una de ellas sale la primera; acierto@${K}: está entre los ${K} fragmentos que
recibe el modelo; MRR: media de 1 / posición (0 si no aparece).

| Búsqueda | Directas: acierto@1 | acierto@${K} | MRR | Reformuladas: acierto@1 | acierto@${K} | MRR |
| --- | --- | --- | --- | --- | --- | --- |
${tablaRecuperacion}

## Respuestas

La búsqueda híbrida es la de la app en local; la de palabras, la de la versión
publicada en Vercel, donde Ollama Cloud no ofrece embeddings.

| Métrica | Híbrida | Solo palabras |
| --- | --- | --- |
| Directas con el dato esperado | ${hibrida.fila(directas)} | ${lexica.fila(directas)} |
| Reformuladas con el dato esperado | ${hibrida.fila(reformuladas)} | ${lexica.fila(reformuladas)} |
| Ajenas al proyecto rechazadas | ${hibrida.fila(fuera)} | ${lexica.fila(fuera)} |
| Respuestas que citan una fuente | ${hibrida.citadas} / ${dentro.length} | ${lexica.citadas} / ${dentro.length} |
| Tiempo medio de respuesta | ${hibrida.tiempo.toFixed(1)} s | ${lexica.tiempo.toFixed(1)} s |

La comprobación es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guardan las respuestas de la búsqueda híbrida:

| Híbrida | Palabras | Pregunta | Respuesta (híbrida) |
| --- | --- | --- | --- |
${preguntas.map((p) => `| ${marca(hibrida.ok.get(p))} | ${marca(lexica.ok.get(p))} | ${p.pregunta} | ${celda(hibrida.textos.get(p))} |`).join("\n")}
`;
writeFileSync("../docs/evaluacion_asistente.md", informe, "utf-8");
console.log("\n" + informe.split("La comprobación")[0]);
