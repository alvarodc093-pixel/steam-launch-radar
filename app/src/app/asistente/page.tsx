import type { Metadata } from "next";

import Chat from "@/components/Chat";

export const metadata: Metadata = { title: "Asistente" };

export default function PaginaAsistente() {
  return (
    <>
      <h1>Pregunta a los datos</h1>
      <p className="entradilla">
        Un asistente que responde con la documentación del proyecto y las fichas de todos los juegos
        descargados. Antes de contestar busca los fragmentos más relevantes y el modelo de lenguaje
        redacta la respuesta solo con ellos, citando de dónde sale cada dato.
      </p>
      <Chat />

      <h2>Cómo funciona</h2>
      <div className="rejilla">
        <div className="panel">
          <h3>1. Busca</h3>
          <p className="nota">
            Cada pregunta se compara con unos 4.100 fragmentos: las secciones del README, las
            conclusiones de los notebooks y una ficha por juego. Se combinan dos búsquedas, por
            palabras (BM25) y por significado (embeddings de <code>embeddinggemma</code>), y se
            quedan los seis fragmentos mejor situados en ambas.
          </p>
        </div>
        <div className="panel">
          <h3>2. Redacta</h3>
          <p className="nota">
            Un modelo de lenguaje servido con Ollama recibe la pregunta y esos fragmentos numerados,
            con la instrucción de responder solo con ellos y citar cada dato. Si la respuesta no
            está en las fuentes, lo dice.
          </p>
        </div>
        <div className="panel">
          <h3>3. Se evalúa</h3>
          <p className="nota">
            Con 22 preguntas de referencia: la búsqueda encuentra la fuente correcta en las 18 que
            la tienen, las 19 respuestas sobre el proyecto contienen el dato esperado y las 3
            preguntas ajenas al proyecto se rechazan. El detalle está en{" "}
            <code>docs/evaluacion_asistente.md</code>.
          </p>
        </div>
      </div>
    </>
  );
}
