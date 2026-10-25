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
            conclusiones de los notebooks y una ficha por juego. Siempre se busca por palabras
            (BM25); si hay un modelo de embeddings disponible, como al ejecutar la app en local con
            Ollama, esa búsqueda se combina con otra por significado (<code>embeddinggemma</code>).
            En esta versión publicada, Ollama Cloud no ofrece embeddings y la búsqueda es solo por
            palabras. Cada respuesta indica cuál se usó.
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
            Con 27 preguntas de referencia. De las 19 directas responde bien 19 en local y 18 en
            esta versión publicada; de las 5 reformuladas con otras palabras, 3 y 2. Las 3 preguntas
            ajenas al proyecto se rechazan siempre. El detalle está en{" "}
            <code>docs/evaluacion_asistente.md</code>.
          </p>
        </div>
      </div>
    </>
  );
}
