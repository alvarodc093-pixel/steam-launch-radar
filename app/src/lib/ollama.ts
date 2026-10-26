/** Cliente mínimo de la API de Ollama: el chat en streaming que redacta las respuestas.

En local apunta al Ollama del equipo (http://localhost:11434). En Vercel no
hay Ollama local, así que OLLAMA_HOST apunta a Ollama Cloud
(https://ollama.com) y OLLAMA_API_KEY lleva la clave.
*/

export interface Destino {
  host: string;
  clave: string;
  modelo: string;
}

export const CONFIG: Destino = {
  host: (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, ""),
  clave: process.env.OLLAMA_API_KEY ?? "",
  modelo: process.env.OLLAMA_MODELO ?? "qwen3.5",
};

export interface MensajeOllama {
  role: "system" | "user" | "assistant";
  content: string;
}

export function cabeceras(destino: Destino = CONFIG): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(destino.clave ? { Authorization: `Bearer ${destino.clave}` } : {}),
  };
}

export class ErrorOllama extends Error {}

/**
 * Devuelve los trozos de texto de la respuesta según los genera el modelo.
 * `destino` permite a la evaluación comparar el modelo local con el publicado.
 */
export async function* chat(
  mensajes: MensajeOllama[],
  cancelar?: AbortSignal,
  destino: Destino = CONFIG,
): AsyncGenerator<string> {
  // Se corta si tarda demasiado o si quien preguntó cierra la página.
  const limite = AbortSignal.timeout(120_000);
  const senal = cancelar ? AbortSignal.any([limite, cancelar]) : limite;
  let r: Response;
  try {
    r = await fetch(`${destino.host}/api/chat`, {
      method: "POST",
      headers: cabeceras(destino),
      body: JSON.stringify({
        model: destino.modelo,
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
    throw new ErrorOllama(`No se puede conectar con Ollama en ${destino.host}.`);
  }
  if (!r.ok || !r.body) {
    const detalle = await r.text().catch(() => "");
    throw new ErrorOllama(
      r.status === 404
        ? `El modelo «${destino.modelo}» no está disponible en Ollama.`
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
