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
            Con 43 preguntas de referencia, 16 de ellas de reserva: escritas después de ajustar la
            búsqueda, para comprobar que funciona con preguntas nuevas. En esas, de 10 preguntas
            directas responde bien 10 en local y 8 en esta versión publicada; las formuladas con
            otras palabras son su punto débil (3 de 6 y 1 de 6). Las preguntas ajenas al proyecto se
            rechazan siempre. El detalle está en <code>docs/evaluacion_asistente.md</code>.
          </p>
        </div>
      </div>
    </>
  );
}
