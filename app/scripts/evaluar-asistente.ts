// Evaluación del asistente con Ollama en marcha (npm run evaluar-asistente).
//
// 1. Recuperación: con cada pregunta de tests/preguntas_asistente.json mira si
//    el fragmento esperado sale primero (acierto@1) o entre los seis que se
//    pasan al modelo (acierto@6), y su posición media (MRR), para la búsqueda
//    por palabras, por embeddings y la combinación de ambas.
// 2. Respuestas: con la búsqueda híbrida, si la respuesta contiene la cifra o
//    el dato esperado, si cita fuentes y si reconoce que no sabe cuando la
//    pregunta queda fuera del proyecto.
//
// Escribe el resultado en ../docs/evaluacion_asistente.md.
import { readFileSync, writeFileSync } from "node:fs";

import { construirPrompt } from "../src/lib/asistente.ts";
import { chat, CONFIG, embeddingConsulta } from "../src/lib/ollama.ts";
import { Buscador, type IndiceRag, type ModoBusqueda } from "../src/lib/rag.ts";

interface Pregunta {
  pregunta: string;
  fuente?: string;
  contiene?: string[];
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

// --- recuperación -------------------------------------------------------------
const conFuente = preguntas.filter((p) => p.fuente);
const modos: ModoBusqueda[] = ["lexica", "semantica", "hibrida"];
const filasRecuperacion = modos.map((modo) => {
  let a1 = 0;
  let a6 = 0;
  let mrr = 0;
  for (const p of conFuente) {
    const { resultados } = buscador.buscar(p.pregunta, vectores.get(p.pregunta)!, K, modo);
    const posicion = resultados.findIndex((r) => r.fragmento.id.startsWith(p.fuente!));
    if (posicion === 0) a1++;
    if (posicion >= 0) {
      a6++;
      mrr += 1 / (posicion + 1);
    }
  }
  const n = conFuente.length;
  return { modo, a1: a1 / n, a6: a6 / n, mrr: mrr / n };
});

// --- respuestas ----------------------------------------------------------------
const detalle: string[] = [];
let correctas = 0;
let citadas = 0;
let rechazos = 0;
let tiempo = 0;
const dentro = preguntas.filter((p) => !p.fuera_de_alcance);
const fuera = preguntas.filter((p) => p.fuera_de_alcance);

for (const p of preguntas) {
  const mensajes = [{ rol: "usuario" as const, texto: p.pregunta }];
  const { resultados } = buscador.buscar(p.pregunta, vectores.get(p.pregunta)!, K);
  const inicio = performance.now();
  let respuesta = "";
  for await (const trozo of chat(construirPrompt(mensajes, resultados))) respuesta += trozo;
  tiempo += performance.now() - inicio;

  const minusculas = respuesta.toLowerCase();
  let ok: boolean;
  if (p.fuera_de_alcance) {
    ok = NO_SABE.some((f) => minusculas.includes(f));
    if (ok) rechazos++;
  } else {
    ok = p.contiene!.some((c) => minusculas.includes(c.toLowerCase()));
    if (ok) correctas++;
    if (/\[\d+\]/.test(respuesta)) citadas++;
  }
  console.log(`${ok ? "ok   " : "FALLO"} ${p.pregunta}`);
  detalle.push(
    `| ${ok ? "✓" : "✗"} | ${p.pregunta} | ${respuesta.replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 220)} |`,
  );
}

const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
const nombres: Record<ModoBusqueda, string> = {
  lexica: "Palabras (BM25)",
  semantica: `Embeddings (${modelo})`,
  hibrida: "Híbrida (RRF)",
};
const informe = `# Evaluación del asistente

Generado con \`npm run evaluar-asistente\` el ${new Date().toISOString().slice(0, 10)}.
Modelo de lenguaje: \`${CONFIG.modelo}\`; embeddings: \`${modelo}\`; índice de
${indice.fragmentos.length} fragmentos; ${preguntas.length} preguntas de referencia
(\`app/tests/preguntas_asistente.json\`), ${fuera.length} de ellas fuera del alcance del proyecto.

## Recuperación

${conFuente.length} preguntas con un fragmento esperado. Acierto@1: el fragmento sale
el primero; acierto@${K}: está entre los ${K} que recibe el modelo; MRR: media de
1 / posición (0 si no aparece).

| Búsqueda | Acierto@1 | Acierto@${K} | MRR |
| --- | --- | --- | --- |
${filasRecuperacion.map((f) => `| ${nombres[f.modo]} | ${pct(f.a1)} | ${pct(f.a6)} | ${f.mrr.toFixed(2)} |`).join("\n")}

## Respuestas (búsqueda híbrida)

| Métrica | Resultado |
| --- | --- |
| Contienen el dato esperado | ${correctas} / ${dentro.length} (${pct(correctas / dentro.length)}) |
| Citan al menos una fuente | ${citadas} / ${dentro.length} (${pct(citadas / dentro.length)}) |
| Reconocen que no lo saben (fuera de alcance) | ${rechazos} / ${fuera.length} |
| Tiempo medio de respuesta | ${(tiempo / preguntas.length / 1000).toFixed(1)} s |

La comprobación es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guarda cada respuesta:

| | Pregunta | Respuesta |
| --- | --- | --- |
${detalle.join("\n")}
`;
writeFileSync("../docs/evaluacion_asistente.md", informe, "utf-8");
console.log("\n" + informe.split("## Respuestas")[0]);
console.log(
  `Respuestas correctas: ${correctas}/${dentro.length}; rechazos: ${rechazos}/${fuera.length}`,
);
