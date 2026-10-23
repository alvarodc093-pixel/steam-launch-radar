"use client";

import { useState } from "react";

import { entero, NOMBRE_BANDA, NOMBRE_MES } from "@/lib/formato";
import type { LecturaPrevia } from "@/lib/radar";

interface Props {
  generos: string[];
}

export default function FormularioPrevio({ generos }: Props) {
  const [genero, setGenero] = useState("");
  const [precio, setPrecio] = useState("");
  const [mes, setMes] = useState(String(new Date().getMonth() + 1));
  const [respuesta, setRespuesta] = useState<{ banda: string; lectura: LecturaPrevia } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setError(null);
    if (!genero || precio === "") {
      setError("Elige un género e indica el precio previsto.");
      return;
    }
    try {
      const r = await fetch("/api/previo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genero, precio_usd: Number(precio), mes_lanzamiento: Number(mes) }),
      });
      const datos = await r.json();
      if (!r.ok) setError(datos.error ?? `Error ${r.status}`);
      else setRespuesta(datos);
    } catch {
      setError("No se ha podido contactar con el servidor.");
    }
  }

  const l = respuesta?.lectura;
  return (
    <div className="dos-columnas">
      <form className="panel" onSubmit={enviar} noValidate>
        <div className="campo">
          <label htmlFor="g">Género principal</label>
          <select id="g" value={genero} onChange={(e) => setGenero(e.target.value)}>
            <option value="">— Elige —</option>
            {generos.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="p">Precio previsto en dólares</label>
          <input id="p" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="m">Mes de lanzamiento</label>
          <select id="m" value={mes} onChange={(e) => setMes(e.target.value)}>
            {NOMBRE_MES.map((n, i) => (
              <option key={n} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button type="submit">Ver juegos parecidos</button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>

      <section aria-live="polite">
        {!l ? (
          <div className="panel nota">
            Elige género y precio para ver cuántas reseñas suelen sumar en su primer mes los
            juegos parecidos de la muestra.
          </div>
        ) : (
          <>
            {l.benchmark ? (
              <div className="panel">
                <div className="etiqueta">
                  Juegos parecidos: {l.benchmark.genero}
                  {l.benchmark.banda ? ` · ${NOMBRE_BANDA[l.benchmark.banda]}` : " (todos los precios)"}
                </div>
                <div className="cifra">{entero(l.benchmark.cuantiles[2])} reseñas</div>
                <p className="nota" style={{ marginBottom: 0 }}>
                  es la mediana a 30 días de {l.benchmark.n} lanzamientos. La mitad central va de{" "}
                  {entero(l.benchmark.cuantiles[1])} a {entero(l.benchmark.cuantiles[3])}, y uno de
                  cada diez supera {entero(l.benchmark.cuantiles[4])}.
                </p>
              </div>
            ) : (
              <p className="aviso">No hay suficientes juegos de ese género en la muestra.</p>
            )}
            {l.superaBaseline ? (
              <p className="nota">
                Ajustando por precio y mes, el modelo estima ~{entero(l.estimacion.central)} reseñas
                (rango del 90 %: {entero(l.estimacion.inferior)} – {entero(l.estimacion.superior)}).
              </p>
            ) : (
              <p className="aviso" style={{ marginTop: "1rem" }}>
                No mostramos una cifra concreta: con solo género, precio y mes, el modelo no
                acierta mejor que la mediana de la muestra en lanzamientos que no había visto. Antes de lanzar lo útil es el rango de
                juegos parecidos; la estimación fiable llega con las primeras reseñas (pestaña
                Radar).
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
