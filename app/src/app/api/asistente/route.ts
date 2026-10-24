/** POST /api/asistente — responde preguntas con lo que recupera del índice (RAG).

La respuesta es NDJSON: primero una línea con las fuentes recuperadas y el
modo de búsqueda, después los trozos del texto según los genera el modelo y
al final una línea de cierre o de error. Así la página enseña las fuentes al
momento y el texto conforme llega, y si Ollama no responde el usuario se
queda al menos con los fragmentos encontrados.
*/

import { NextResponse } from "next/server";

import { consultaDeBusqueda, construirPrompt, validarConversacion } from "@/lib/asistente";
import { buscadorRag } from "@/lib/datos";
import { chat, embeddingConsulta, ErrorOllama } from "@/lib/ollama";

export const dynamic = "force-dynamic";
// Un modelo local en CPU puede tardar en contestar.
export const maxDuration = 120;

export async function POST(request: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo tiene que ser JSON válido." }, { status: 400 });
  }
  const conversacion = validarConversacion(cuerpo);
  if (!conversacion.ok) return NextResponse.json({ error: conversacion.error }, { status: 400 });

  let buscador;
  try {
    buscador = await buscadorRag();
  } catch {
    return NextResponse.json(
      { error: "Falta el índice del asistente. Ejecuta `python -m radar.rag`." },
      { status: 503 },
    );
  }

  const consulta = consultaDeBusqueda(conversacion.valor);
  const embeddings = buscador.indice.embeddings;
  const vector = embeddings
    ? await embeddingConsulta(embeddings.prefijo_consulta + consulta, embeddings.modelo)
    : null;
  const { modo, resultados } = buscador.buscar(consulta, vector);

  const fuentes = resultados.map(({ fragmento }) => ({
    titulo: fragmento.titulo,
    tipo: fragmento.tipo,
    appid: fragmento.appid,
    extracto: fragmento.texto.slice(0, 280),
  }));

  const codificador = new TextEncoder();
  const linea = (dato: unknown) => codificador.encode(JSON.stringify(dato) + "\n");
  const flujo = new ReadableStream<Uint8Array>({
    async start(control) {
      control.enqueue(linea({ tipo: "fuentes", modo, fuentes }));
      try {
        for await (const trozo of chat(construirPrompt(conversacion.valor, resultados))) {
          control.enqueue(linea({ tipo: "texto", texto: trozo }));
        }
        control.enqueue(linea({ tipo: "fin" }));
      } catch (error) {
        const mensaje =
          error instanceof ErrorOllama
            ? error.message
            : "El modelo de lenguaje dejó de responder a mitad de la respuesta.";
        control.enqueue(linea({ tipo: "error", mensaje }));
      }
      control.close();
    },
  });

  return new Response(flujo, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
