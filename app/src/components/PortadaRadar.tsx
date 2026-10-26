"use client";

import { useMemo } from "react";

import Grafico, { type Serie } from "@/components/Grafico";
import { dolares, entero, porcentaje } from "@/lib/formato";
import type { Veredicto } from "@/lib/radar";

export interface Destacado {
  appid: number;
  nombre: string;
  genero: string;
  precio_usd: number;
  resenas: number;
  veredicto: Veredicto;
  estimacion: number;
}

export interface DatosPortada {
  /** Día de lectura con el que se calcularon los destacados. */
  dia: number;
  destacados: Destacado[];
  precision: { dia: number; factor: number; cobertura: number | undefined }[];
  /** Fracción del mes acumulada cada día (mediana de toda la muestra). */
  curva: number[];
  nEntrenamiento: number;
}

const CORTO: Record<Veredicto, string> = {
  por_encima: "Por encima",
  en_linea: "En línea",
  por_debajo: "Por debajo",
};

const GUIA: Record<Veredicto, string> = {
  por_encima: "Todo el rango estimado supera a tres de cada cuatro juegos de su género.",
  en_linea: "El rango se solapa con la mitad central: aún no hay señal clara.",
  por_debajo: "Ni el escenario optimista llega al cuartil inferior de su género.",
};

export default function PortadaRadar({
  datos,
  onProbar,
  cargando,
}: {
  datos: DatosPortada;
  onProbar: (appid: number) => void;
  cargando: boolean;
}) {
  const { dia, destacados, precision, curva } = datos;

  const series = useMemo<Serie[]>(() => {
    const pct = curva.map((v) => Math.round(v * 1000) / 10);
    const marcas = new Set(precision.map((p) => p.dia));
    return [
      { etiqueta: "Del mes ya recibido (mediana)", valores: pct, color: "#1e7a52" },
      {
        etiqueta: "Días de lectura del radar",
        valores: pct.map((v, i) => (marcas.has(i + 1) ? v : null)),
        color: "#b3402a",
        soloPuntos: true,
      },
    ];
  }, [curva, precision]);
  const etiquetas = useMemo(() => curva.map((_, i) => String(i + 1)), [curva]);
  const cobertura = precision.find((p) => p.dia === dia)?.cobertura;

  return (
    <div className="portada">
      <div className="panel">
        <h2 className="titulo-panel">Pruébalo con un lanzamiento real</h2>
        <p className="nota" style={{ marginTop: 0 }}>
          Tres juegos del conjunto de test, uno por veredicto, leídos el día {dia}. Están elegidos
          entre los que acabaron dentro del rango estimado, para enseñar cómo funciona; no todos
          acaban así
          {cobertura !== undefined && (
            <>: en la prueba, el rango acertó en el {porcentaje(cobertura)} de los juegos</>
          )}
          . En el buscador del radar están todos los juegos de test, aciertos y fallos.
        </p>
        <div className="casos">
          {destacados.map((d) => (
            <button
              key={d.appid}
              type="button"
              className="caso"
              disabled={cargando}
              onClick={() => onProbar(d.appid)}
            >
              <span className={`chip ${d.veredicto}`}>{CORTO[d.veredicto]}</span>
              <span className="caso-nombre">{d.nombre}</span>
              <span className="nota">
                {d.genero} · {dolares(d.precio_usd)}
              </span>
              <span className="caso-cifras">
                <span>
                  <strong>{entero(d.resenas)}</strong> reseñas el día {dia}
                </span>
                <span>
                  → <strong>~{entero(d.estimacion)}</strong> a 30 días
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="rejilla rejilla-estrecha">
        {precision.map((p) => (
          <div className="panel" key={p.dia}>
            <div className="etiqueta">Leyendo el día {p.dia}</div>
            <div className="cifra">×{p.factor.toFixed(2).replace(".", ",")}</div>
            <div className="nota">
              error típico
              {p.cobertura !== undefined && <>; el rango acierta el {porcentaje(p.cobertura)}</>}
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 className="titulo-panel">Las reseñas llegan pronto</h2>
        <Grafico
          tipo="line"
          etiquetas={etiquetas}
          series={series}
          ejeX="Día desde el lanzamiento"
          ejeY="% de las reseñas del primer mes"
          resumen={`En el lanzamiento mediano, el día ${precision
            .map((p) => `${p.dia} ya ha llegado el ${porcentaje(curva[p.dia - 1])}`)
            .join(
              ", el ",
            )} de las reseñas del primer mes. Por eso unos pocos días bastan para estimar el mes entero.`}
        />
      </div>

      <div className="panel">
        <h2 className="titulo-panel">Cómo se lee el veredicto</h2>
        <ul className="guia">
          {(Object.keys(GUIA) as Veredicto[]).map((v) => (
            <li key={v}>
              <span className={`chip ${v}`}>{CORTO[v]}</span>
              <span>{GUIA[v]}</span>
            </li>
          ))}
        </ul>
        <p className="nota" style={{ marginBottom: 0 }}>
          El modelo se entrenó con {entero(datos.nEntrenamiento)} lanzamientos y se comprobó con
          juegos que no había visto.
        </p>
      </div>
    </div>
  );
}
