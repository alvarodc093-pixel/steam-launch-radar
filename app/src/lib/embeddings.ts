/** Embedding de la consulta dentro de la propia app, sin servicios externos.

El índice se construye con embeddinggemma servido por Ollama (radar/rag.py).
Ollama Cloud no ofrece modelos de embeddings, así que en Vercel la búsqueda
por significado se quedaba fuera. Aquí se ejecuta el mismo modelo, en su
versión ONNX cuantizada a 4 bits: sus vectores coinciden con los de Ollama
(coseno 0,97) y la búsqueda acierta lo mismo con las preguntas de referencia.

El modelo (unos 200 MB) no va en el despliegue: se descarga la primera vez
que se necesita y queda en memoria mientras la función siga activa.
*/

import type { PreTrainedModel, PreTrainedTokenizer } from "@huggingface/transformers";

const MODELO = "onnx-community/embeddinggemma-300m-ONNX";
// Revisión fija: un cambio en el repositorio del modelo no cambia la app.
const REVISION = "5090578d9565bb06545b4552f76e6bc2c93e4a66";
/** Nombre con el que el índice declara sus vectores; otro modelo no sería comparable. */
export const MODELO_INDICE = "embeddinggemma";
// En la primera pregunta tras un arranque en frío el modelo aún se está
// descargando: pasado este tiempo se responde buscando solo por palabras.
const ESPERA_MS = 15_000;

interface Cargado {
  tokenizador: PreTrainedTokenizer;
  modelo: PreTrainedModel;
}

let carga: Promise<Cargado> | null = null;

/** Desactivado con RAG_EMBEDDINGS=no (en el CI, para no descargar el modelo). */
export function embeddingsActivos(): boolean {
  return process.env.RAG_EMBEDDINGS !== "no";
}

/** Empieza a cargar el modelo sin esperar; las llamadas siguientes lo reutilizan. */
export function precargar(): Promise<Cargado> {
  carga ??= (async () => {
    const { AutoModel, AutoTokenizer, env } = await import("@huggingface/transformers");
    // En Vercel solo se puede escribir en /tmp.
    if (process.env.VERCEL) env.cacheDir = "/tmp/modelos";
    const [tokenizador, modelo] = await Promise.all([
      AutoTokenizer.from_pretrained(MODELO, { revision: REVISION }),
      AutoModel.from_pretrained(MODELO, { revision: REVISION, dtype: "q4" }),
    ]);
    return { tokenizador, modelo };
  })().catch((error: unknown) => {
    carga = null; // se reintenta en la siguiente pregunta
    throw error;
  });
  return carga;
}

/**
 * Vector normalizado de `texto` (con su prefijo de consulta ya puesto), o null
 * si el modelo no está listo a tiempo o falla: entonces el asistente busca
 * solo por palabras en lugar de quedarse sin responder.
 */
export async function embeddingConsulta(
  texto: string,
  esperaMs = ESPERA_MS,
): Promise<number[] | null> {
  if (!embeddingsActivos()) return null;
  try {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const tarde = new Promise<null>((resolver) => {
      temporizador = setTimeout(resolver, esperaMs, null);
    });
    const listo = await Promise.race([precargar(), tarde]);
    clearTimeout(temporizador);
    if (!listo) return null;
    const entrada = await listo.tokenizador([texto], { padding: true, truncation: true });
    const { sentence_embedding } = await listo.modelo(entrada);
    return Array.from(sentence_embedding.data as Float32Array);
  } catch {
    return null;
  }
}
