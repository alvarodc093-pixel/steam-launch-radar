/** Cliente mínimo de la API de Ollama: embeddings y chat en streaming.

En local apunta al Ollama del equipo (http://localhost:11434). En Vercel no
hay Ollama local, así que OLLAMA_HOST apunta a Ollama Cloud
(https://ollama.com) y OLLAMA_API_KEY lleva la clave.
*/

export const CONFIG = {
  host: (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, ""),
  clave: process.env.OLLAMA_API_KEY ?? "",
  modelo: process.env.OLLAMA_MODELO ?? "qwen3.5",
};

export interface MensajeOllama {
  role: "system" | "user" | "assistant";
  content: string;
}

function cabeceras(): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(CONFIG.clave ? { Authorization: `Bearer ${CONFIG.clave}` } : {}),
  };
}

/**
 * Vector de la consulta, o null si el modelo de embeddings no está disponible
 * (Ollama apagado, o un servicio en la nube que no lo ofrece): entonces el
 * asistente busca solo por palabras en lugar de fallar.
 */
export async function embeddingConsulta(texto: string, modelo: string): Promise<number[] | null> {
  try {
    const r = await fetch(`${CONFIG.host}/api/embed`, {
      method: "POST",
      headers: cabeceras(),
      body: JSON.stringify({ model: modelo, input: texto }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const cuerpo = (await r.json()) as { embeddings?: number[][] };
    return cuerpo.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

export class ErrorOllama extends Error {}

/** Devuelve los trozos de texto de la respuesta según los genera el modelo. */
export async function* chat(
  mensajes: MensajeOllama[],
  cancelar?: AbortSignal,
): AsyncGenerator<string> {
  // Se corta si tarda demasiado o si quien preguntó cierra la página.
  const limite = AbortSignal.timeout(120_000);
  const senal = cancelar ? AbortSignal.any([limite, cancelar]) : limite;
  let r: Response;
  try {
    r = await fetch(`${CONFIG.host}/api/chat`, {
      method: "POST",
      headers: cabeceras(),
      body: JSON.stringify({
        model: CONFIG.modelo,
        messages: mensajes,
        stream: true,
        // Sin el razonamiento previo de los modelos que lo tienen: tarda más y
        // para resumir unos fragmentos no aporta.
        think: false,
        // Sin azar: la misma pregunta con las mismas fuentes da la misma
        // respuesta, que es lo que se espera de un asistente sobre datos.
        options: { temperature: 0, seed: 42 },
      }),
      signal: senal,
    });
  } catch {
    throw new ErrorOllama(`No se puede conectar con Ollama en ${CONFIG.host}.`);
  }
  if (!r.ok || !r.body) {
    const detalle = await r.text().catch(() => "");
    throw new ErrorOllama(
      r.status === 404
        ? `El modelo «${CONFIG.modelo}» no está disponible en Ollama.`
        : `Ollama respondió con un error ${r.status}. ${detalle.slice(0, 200)}`,
    );
  }

  // Cada línea es un JSON con un trozo de la respuesta.
  const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let pendiente = "";
  while (true) {
    const { value, done } = await lector.read();
    if (done) break;
    pendiente += value;
    const lineas = pendiente.split("\n");
    pendiente = lineas.pop() ?? "";
    for (const linea of lineas) {
      if (!linea.trim()) continue;
      const parte = JSON.parse(linea) as { message?: { content?: string }; error?: string };
      if (parte.error) throw new ErrorOllama(parte.error);
      if (parte.message?.content) yield parte.message.content;
    }
  }
}
