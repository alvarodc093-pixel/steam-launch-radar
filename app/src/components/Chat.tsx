"use client";

import { useEffect, useRef, useState } from "react";

import type { ModoBusqueda } from "@/lib/rag";

interface Fuente {
  titulo: string;
  tipo: "documentacion" | "juego";
  appid?: number;
  extracto: string;
}

interface Turno {
  rol: "usuario" | "asistente";
  texto: string;
  fuentes?: Fuente[];
  modo?: ModoBusqueda;
  error?: string;
}

const SUGERENCIAS = [
  "¿Qué parte de las reseñas del primer mes llega en la primera semana?",
  "¿Por qué a día 7 el radar usa una regla simple y no gradient boosting?",
  "¿Cuántas reseñas tuvo Pax Autocratica en su primer mes?",
  "¿Qué juegos se excluyeron de la muestra y por qué?",
];

const MODOS: Record<ModoBusqueda, string> = {
  hibrida: "búsqueda híbrida: palabras y embeddings",
  lexica: "búsqueda por palabras (BM25)",
  semantica: "búsqueda por embeddings",
};

/**
 * Negritas de Markdown (**así**), lo único que suelen usar los modelos aquí.
 * gpt-oss cita con su propio formato (【4†L13-L16】): se deja como [4].
 */
function conNegritas(texto: string) {
  return texto
    .replace(/【(\d+)[^】]*】/g, "[$1]")
    .split(/(\*\*[^*]+\*\*)/g)
    .map((parte, i) =>
      parte.startsWith("**") && parte.endsWith("**") ? (
        <strong key={i}>{parte.slice(2, -2)}</strong>
      ) : (
        parte
      ),
    );
}

export default function Chat() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pregunta, setPregunta] = useState("");
  const [esperando, setEsperando] = useState(false);
  const final = useRef<HTMLDivElement>(null);

  useEffect(() => {
    final.current?.scrollIntoView({ block: "nearest" });
  }, [turnos]);

  function actualizarUltimo(cambio: (t: Turno) => Turno) {
    setTurnos((ts) => [...ts.slice(0, -1), cambio(ts.at(-1)!)]);
  }

  async function preguntar(texto: string) {
    const limpia = texto.trim();
    if (!limpia || esperando) return;
    // Solo viajan los turnos que se completaron: un error no es parte de la conversación.
    const historial = turnos
      .filter((t) => !t.error && t.texto)
      .slice(-10)
      .map(({ rol, texto }) => ({ rol, texto }));
    setTurnos((ts) => [...ts, { rol: "usuario", texto: limpia }, { rol: "asistente", texto: "" }]);
    setPregunta("");
    setEsperando(true);

    try {
      const r = await fetch("/api/asistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensajes: [...historial, { rol: "usuario", texto: limpia }] }),
      });
      if (!r.ok || !r.body) {
        const cuerpo = await r.json().catch(() => ({}));
        throw new Error(cuerpo.error ?? `Error ${r.status}`);
      }
      const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let pendiente = "";
      while (true) {
        const { value, done } = await lector.read();
        if (done) break;
        pendiente += value;
        const lineas = pendiente.split("\n");
        pendiente = lineas.pop() ?? "";
        for (const linea of lineas.filter(Boolean)) {
          const evento = JSON.parse(linea);
          if (evento.tipo === "fuentes") {
            actualizarUltimo((t) => ({ ...t, fuentes: evento.fuentes, modo: evento.modo }));
          } else if (evento.tipo === "texto") {
            actualizarUltimo((t) => ({ ...t, texto: t.texto + evento.texto }));
          } else if (evento.tipo === "error") {
            actualizarUltimo((t) => ({ ...t, error: evento.mensaje }));
          }
        }
      }
    } catch (error) {
      const mensaje =
        error instanceof Error && error.message !== "Failed to fetch"
          ? error.message
          : "No se ha podido contactar con el servidor.";
      actualizarUltimo((t) => ({ ...t, error: mensaje }));
    } finally {
      setEsperando(false);
    }
  }

  return (
    <div className="chat">
      {turnos.length === 0 && (
        <div className="panel">
          <h2 className="titulo-panel">Prueba con una de estas preguntas</h2>
          <div className="sugerencias">
            {SUGERENCIAS.map((s) => (
              <button
                key={s}
                type="button"
                className="sugerencia"
                onClick={() => void preguntar(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="conversacion" aria-live="polite">
        {turnos.map((t, i) =>
          t.rol === "usuario" ? (
            <div key={i} className="burbuja usuario">
              {t.texto}
            </div>
          ) : (
            <div key={i} className="burbuja asistente">
              {t.texto ? (
                <div className="respuesta">{conNegritas(t.texto)}</div>
              ) : (
                !t.error && <div className="nota">{t.fuentes ? "Redactando…" : "Buscando…"}</div>
              )}
              {t.error && (
                <p className="error" role="alert">
                  {t.error}
                  {t.fuentes?.length ? " Estas son las fuentes que se encontraron:" : ""}
                </p>
              )}
              {t.fuentes && t.fuentes.length > 0 && (
                <details className="fuentes" open={Boolean(t.error)}>
                  <summary>
                    {t.fuentes.length} fuentes · {t.modo && MODOS[t.modo]}
                  </summary>
                  <ol>
                    {t.fuentes.map((f, j) => (
                      <li key={j}>
                        <strong>{f.titulo}</strong>
                        {f.tipo === "juego" && f.appid && (
                          <>
                            {" "}
                            ·{" "}
                            <a
                              href={`https://store.steampowered.com/app/${f.appid}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              ver en Steam
                            </a>
                          </>
                        )}
                        <div className="nota">{f.extracto}…</div>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          ),
        )}
        <div ref={final} />
      </div>

      <form
        className="panel caja-pregunta"
        onSubmit={(e) => {
          e.preventDefault();
          void preguntar(pregunta);
        }}
      >
        <label htmlFor="pregunta" className="solo-lectores">
          Tu pregunta
        </label>
        <input
          id="pregunta"
          value={pregunta}
          maxLength={1000}
          placeholder="Pregunta por un juego, por los datos o por cómo funciona el radar"
          onChange={(e) => setPregunta(e.target.value)}
        />
        <button type="submit" disabled={esperando || !pregunta.trim()}>
          {esperando ? "Pensando…" : "Preguntar"}
        </button>
      </form>
    </div>
  );
}
