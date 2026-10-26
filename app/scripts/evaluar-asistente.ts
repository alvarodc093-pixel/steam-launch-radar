// Evaluación del asistente con Ollama en marcha (npm run evaluar-asistente).
//
// 1. Recuperación: con cada pregunta de tests/preguntas_asistente.json mira si
//    alguna de sus fuentes esperadas sale primero (acierto@1) o entre los seis
//    fragmentos que se pasan al modelo (acierto@6), con tres búsquedas: por
//    palabras (la de la versión publicada, donde no hay embeddings), por
//    embeddings e híbrida (la de la app en local).
// 2. Respuestas, con el modelo local y con el publicado (si hay NUBE_API_KEY):
//    si contienen el dato esperado, si citan fuentes y si reconocen que no
//    saben cuando la pregunta queda fuera del proyecto.
// 3. Redacción: un juez automático puntúa fidelidad a las fuentes, pertinencia
//    y claridad de cada respuesta.
//
// Las preguntas «reformuladas» evitan las palabras de la documentación. Las de
// «reserva» se escribieron después de ajustar la búsqueda con las demás: miden
// si las decisiones generalizan o solo encajan con las preguntas de ajuste.
//
// Escribe el resultado en ../docs/evaluacion_asistente.md.
import { readFileSync, writeFileSync } from "node:fs";

import { construirPrompt } from "../src/lib/asistente.ts";
import { embeddingConsulta } from "../src/lib/embeddings.ts";
import { cabeceras, chat, CONFIG, type Destino } from "../src/lib/ollama.ts";
import {
  Buscador,
  esFuenteEsperada,
  type IndiceRag,
  type ModoBusqueda,
  type Recuperado,
} from "../src/lib/rag.ts";

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
  // La primera llamada descarga el modelo: se le da todo el tiempo que necesite.
  const v = await embeddingConsulta(prefijo_consulta + p.pregunta, 10 * 60_000);
  if (!v) throw new Error(`No se pudo cargar el modelo de embeddings (${modelo})`);
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
// Las dos configuraciones reales, las dos con búsqueda híbrida: el modelo local
// y el de Ollama Cloud que usa la versión publicada.
const NUBE = "https://ollama.com";
const claveNube = process.env.NUBE_API_KEY ?? "";
const destinos: [string, Destino][] = [[`Local (${CONFIG.modelo})`, CONFIG]];
if (claveNube) {
  const modeloNube = process.env.NUBE_MODELO ?? "gpt-oss:120b";
  destinos.push([
    `Publicada (${modeloNube})`,
    { host: NUBE, clave: claveNube, modelo: modeloNube },
  ]);
}
// El juez es de otra familia que los dos modelos que responden, para que
// ninguno se puntúe a sí mismo.
const juez: Destino = {
  host: NUBE,
  clave: claveNube,
  modelo: process.env.JUEZ_MODELO ?? "gemma4:31b",
};

interface Nota {
  fidelidad: number;
  pertinencia: number;
  claridad: number;
}

const INSTRUCCIONES_JUEZ = `Evalúas las respuestas de un asistente que debe contestar SOLO con las fuentes que recibe y citarlas con su número. Puntúa de 1 a 5:
- fidelidad: cada dato de la respuesta está en las fuentes (5 = todo respaldado; 1 = inventa datos).
- pertinencia: responde a lo que se pregunta (5 = de lleno; 1 = no responde).
- claridad: se entiende a la primera, sin rodeos ni texto sobrante (5 = muy clara; 1 = confusa).
Si las fuentes no tienen la respuesta y el asistente lo dice, eso es fiel y pertinente.
Responde solo con JSON: {"fidelidad": n, "pertinencia": n, "claridad": n}`;

/** Puntuación de 1 a 5 de una respuesta, o null si el juez no responde bien. */
async function juzgar(p: Pregunta, fuentes: Recuperado[], respuesta: string): Promise<Nota | null> {
  const numeradas = fuentes.map((r, i) => `[${i + 1}] ${r.fragmento.texto}`).join("\n\n");
  try {
    const r = await fetch(`${juez.host}/api/chat`, {
      method: "POST",
      headers: cabeceras(juez),
      body: JSON.stringify({
        model: juez.modelo,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: INSTRUCCIONES_JUEZ },
          {
            role: "user",
            content: `FUENTES:\n${numeradas}\n\nPREGUNTA: ${p.pregunta}\n\nRESPUESTA: ${respuesta}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    // Aunque se pida JSON, a veces llega dentro de un bloque de código.
    const contenido: string = (await r.json()).message?.content ?? "";
    const nota = JSON.parse(contenido.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Nota;
    const valida = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;
    return valida(nota.fidelidad) && valida(nota.pertinencia) && valida(nota.claridad)
      ? nota
      : null;
  } catch {
    return null;
  }
}

async function responder(nombre: string, destino: Destino) {
  const ok = new Map<Pregunta, boolean>();
  const textos = new Map<Pregunta, string>();
  const notas = new Map<Pregunta, Nota | null>();
  let citadas = 0;
  let tiempo = 0;
  for (const p of preguntas) {
    const fuentes = buscar(p, "hibrida");
    const inicio = performance.now();
    let respuesta = "";
    const mensajes = [{ rol: "usuario" as const, texto: p.pregunta }];
    for await (const trozo of chat(construirPrompt(mensajes, fuentes), undefined, destino)) {
      respuesta += trozo;
    }
    tiempo += performance.now() - inicio;
    const minusculas = respuesta.toLowerCase();
    const bien = p.fuera_de_alcance
      ? NO_SABE.some((f) => minusculas.includes(f))
      : p.contiene!.some((c) => minusculas.includes(c.toLowerCase()));
    if (!p.fuera_de_alcance && /\[\d+\]|【\d+/.test(respuesta)) citadas++;
    ok.set(p, bien);
    textos.set(p, respuesta);
    if (claveNube && !p.fuera_de_alcance) notas.set(p, await juzgar(p, fuentes, respuesta));
    console.log(`${nombre.slice(0, 12).padEnd(12)} ${bien ? "ok   " : "FALLO"} ${p.pregunta}`);
  }
  const cuenta = (g: Pregunta[]) => `${g.filter((p) => ok.get(p)).length}/${g.length}`;
  return { ok, textos, notas, cuenta, citadas, tiempo: tiempo / preguntas.length / 1000 };
}

const respuestas = new Map<string, Awaited<ReturnType<typeof responder>>>();
for (const [nombre, destino] of destinos) respuestas.set(nombre, await responder(nombre, destino));
const columnas = [...respuestas.keys()];
const dentro = preguntas.filter((p) => !p.fuera_de_alcance);
const fila = (titulo: string, valor: (c: string) => string) =>
  `| ${titulo} | ${columnas.map(valor).join(" | ")} |`;

const filasRespuesta = [
  ...grupos.map(([nombre, g]) => fila(nombre, (c) => respuestas.get(c)!.cuenta(g))),
  fila("Ajenas al proyecto rechazadas", (c) => respuestas.get(c)!.cuenta(fuera)),
  fila("Respuestas que citan una fuente", (c) => `${respuestas.get(c)!.citadas}/${dentro.length}`),
  fila("Tiempo medio de respuesta", (c) => `${respuestas.get(c)!.tiempo.toFixed(1)} s`),
].join("\n");

// Media de cada criterio y parte de respuestas con fidelidad 4 o 5.
function resumenNotas(notas: Map<Pregunta, Nota | null>) {
  const validas = [...notas.values()].filter((n): n is Nota => n !== null);
  const media = (k: keyof Nota) =>
    (validas.reduce((s, n) => s + n[k], 0) / validas.length).toFixed(1).replace(".", ",");
  const fieles = validas.filter((n) => n.fidelidad >= 4).length;
  return { media, texto: `${fieles}/${validas.length}` };
}
const criterios = ["fidelidad", "pertinencia", "claridad"] as const;
const tablaJuez = claveNube
  ? `## Calidad de la redacción (juez automático)

Cada respuesta la puntúa de 1 a 5 \`${juez.modelo}\`, un modelo de otra familia que los
que responden, con las mismas fuentes que recibió el asistente.

| Criterio | ${columnas.join(" | ")} |
| --- | ${columnas.map(() => "---").join(" | ")} |
${criterios
  .map((k) =>
    fila(`${k[0].toUpperCase()}${k.slice(1)} (media)`, (c) =>
      resumenNotas(respuestas.get(c)!.notas).media(k),
    ),
  )
  .join("\n")}
${fila("Fidelidad 4 o 5", (c) => resumenNotas(respuestas.get(c)!.notas).texto)}

Un juez automático también se equivoca: sirve para comparar configuraciones y
encontrar respuestas flojas, no como nota absoluta.
`
  : "";

const marca = (v: boolean | undefined) => (v ? "✓" : "✗");
const celda = (t: string | undefined) =>
  (t ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 180);
const ultima = respuestas.get(columnas[columnas.length - 1])!;

const informe = `# Evaluación del asistente

Generado con \`npm run evaluar-asistente\` el ${new Date().toISOString().slice(0, 10)}.
Embeddings: \`${modelo}\`; índice de ${indice.fragmentos.length} fragmentos.
${preguntas.length} preguntas de referencia (\`app/tests/preguntas_asistente.json\`). Las de
**ajuste** se usaron para decidir cómo busca el asistente; las de **reserva** se
escribieron después y no intervinieron en esas decisiones, así que miden si
generalizan. Las **reformuladas** evitan las palabras de la documentación.
${fuera.length} preguntas son ajenas al proyecto.

La versión local y la publicada usan la misma búsqueda híbrida: la consulta se
convierte en vector dentro de la propia app (\`app/src/lib/embeddings.ts\`). Solo
cambia el modelo que redacta.

Se probó también ampliar la búsqueda por palabras con palabras clave que escribe el
modelo de lenguaje antes de buscar. No mejoró el resultado neto y se descartó.

## Recuperación: la fuente esperada está entre los ${K} fragmentos

| Búsqueda | ${grupos.map(([n]) => n).join(" | ")} |
| --- | ${grupos.map(() => "---").join(" | ")} |
${tablaRecuperacion}

## Respuestas con el dato esperado

| Grupo | ${columnas.join(" | ")} |
| --- | ${columnas.map(() => "---").join(" | ")} |
${filasRespuesta}

${tablaJuez}
La comprobación del dato es automática: busca la cifra o el término esperado en la
respuesta, así que una respuesta correcta redactada de otra forma puede contar
como fallo. Por eso se guardan las respuestas (de ${columnas[columnas.length - 1]}):

| ${columnas.map((c) => c.split(" ")[0]).join(" | ")} | Pregunta | Respuesta |
| ${columnas.map(() => "---").join(" | ")} | --- | --- |
${preguntas
  .map(
    (p) =>
      `| ${columnas.map((c) => marca(respuestas.get(c)!.ok.get(p))).join(" | ")} | ${p.reserva ? "(reserva) " : ""}${p.pregunta} | ${celda(ultima.textos.get(p))} |`,
  )
  .join("\n")}
`;
writeFileSync("../docs/evaluacion_asistente.md", informe, "utf-8");
console.log("\n" + informe.split("La comprobación del dato")[0]);
