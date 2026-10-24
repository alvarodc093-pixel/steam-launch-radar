/** Piezas del asistente sin red: validación de la conversación y el prompt. */

import type { Recuperado } from "./rag.ts";
import type { MensajeOllama } from "./ollama.ts";
import type { Resultado } from "./validacion.ts";

export interface Mensaje {
  rol: "usuario" | "asistente";
  texto: string;
}

export const MAX_MENSAJES = 12;
export const MAX_CARACTERES = 1000;

export function validarConversacion(cuerpo: unknown): Resultado<Mensaje[]> {
  const mensajes = (cuerpo as { mensajes?: unknown } | null)?.mensajes;
  if (!Array.isArray(mensajes) || mensajes.length === 0) {
    return { ok: false, error: "mensajes: hace falta al menos una pregunta" };
  }
  if (mensajes.length > MAX_MENSAJES) {
    return { ok: false, error: `mensajes: como mucho ${MAX_MENSAJES} por conversación` };
  }
  const limpios: Mensaje[] = [];
  for (const m of mensajes) {
    const { rol, texto } = (m ?? {}) as Record<string, unknown>;
    if ((rol !== "usuario" && rol !== "asistente") || typeof texto !== "string" || !texto.trim()) {
      return { ok: false, error: "mensajes: cada uno necesita rol (usuario o asistente) y texto" };
    }
    if (rol === "usuario" && texto.length > MAX_CARACTERES) {
      return { ok: false, error: `pregunta: como mucho ${MAX_CARACTERES} caracteres` };
    }
    limpios.push({ rol, texto: texto.trim() });
  }
  if (limpios.at(-1)!.rol !== "usuario") {
    return { ok: false, error: "mensajes: el último tiene que ser una pregunta del usuario" };
  }
  return { ok: true, valor: limpios };
}

/**
 * Texto con el que se busca. Una repregunta como «¿y a día 14?» no dice de
 * qué se habla: se le añade la pregunta anterior del usuario.
 */
export function consultaDeBusqueda(mensajes: Mensaje[]): string {
  const preguntas = mensajes.filter((m) => m.rol === "usuario").map((m) => m.texto);
  const ultima = preguntas.at(-1)!;
  return preguntas.length > 1 && ultima.split(/\s+/).length < 8
    ? `${preguntas.at(-2)} ${ultima}`
    : ultima;
}

const INSTRUCCIONES = `Eres el asistente de Steam Launch Radar, una aplicación que estima con las reseñas de los primeros días cuántas tendrá un juego de Steam al cumplir su primer mes.

Responde en español, en pocas frases, usando solo la información de las fuentes numeradas que acompañan a la pregunta. Cita la fuente de cada dato con su número entre corchetes, por ejemplo [2]. Si las fuentes no contienen la respuesta, dilo claramente y sugiere qué se puede consultar en la aplicación; no inventes cifras ni juegos.

Ten en cuenta que todas las cifras de reseñas son reseñas en inglés, y que son una aproximación a la actividad de un juego, no a sus ventas.`;

export function contexto(recuperados: Recuperado[]): string {
  return recuperados
    .map((r, i) => `[${i + 1}] ${r.fragmento.titulo}\n${r.fragmento.texto}`)
    .join("\n\n");
}

/** Mensajes para el modelo: instrucciones, historial corto y la pregunta con sus fuentes. */
export function construirPrompt(mensajes: Mensaje[], recuperados: Recuperado[]): MensajeOllama[] {
  const historial = mensajes.slice(0, -1).slice(-6);
  const pregunta = mensajes.at(-1)!.texto;
  return [
    { role: "system", content: INSTRUCCIONES },
    ...historial.map<MensajeOllama>((m) => ({
      role: m.rol === "usuario" ? "user" : "assistant",
      content: m.texto,
    })),
    { role: "user", content: `Fuentes:\n\n${contexto(recuperados)}\n\nPregunta: ${pregunta}` },
  ];
}
