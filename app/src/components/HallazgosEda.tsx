import Link from "next/link";

import { decimal, entero, fecha, NOMBRE_BANDA, porcentaje } from "@/lib/formato";
import type { DatosMercado } from "@/lib/tipos";

const ORDEN_BANDAS = ["hasta_10", "hasta_20", "hasta_40", "mas_de_40"];

/**
 * Hallazgos de notebooks/02_eda.ipynb que deciden el producto. Todas las cifras
 * salen de mercado.json, calculadas por las mismas funciones que usa el
 * notebook (radar/eda.py), así que se actualizan al reentrenar.
 */
export default function HallazgosEda({ m }: { m: DatosMercado }) {
  const fracciones = Object.entries(m.fraccion_mediana_del_mes);
  const bandas = ORDEN_BANDAS.flatMap((b) => m.por_banda.filter((x) => x.banda === b));
  const maximo = Math.max(...bandas.map((b) => b.mediana_30d));
  const h = m.hallazgos;

  return (
    <section className="hallazgos" aria-labelledby="titulo-hallazgos">
      <h2 id="titulo-hallazgos">Lo que dicen los datos</h2>
      <p className="entradilla">
        Del análisis de {entero(m.juegos_aptos)} lanzamientos en Steam entre el{" "}
        {fecha(m.rango_lanzamientos.desde)} y el {fecha(m.rango_lanzamientos.hasta)}. El juego
        mediano cierra su primer mes con {entero(m.mediana_resenas_30d)} reseñas en inglés.
      </p>

      <div className="rejilla">
        <div className="panel">
          <h3>El primer mes se decide pronto</h3>
          <ul className="hitos">
            {fracciones.map(([d, f]) => (
              <li key={d}>
                <span className="cifra">{porcentaje(f)}</span>
                <span className="nota">del mes ya ha llegado el día {d}</span>
              </li>
            ))}
          </ul>
          <p className="nota">Esperar al día 30 es perder tiempo de reacción.</p>
        </div>

        <div className="panel">
          <h3>Lo de hoy predice el mes</h3>
          <div className="cifra">ρ = {decimal(h.spearman_7_30, 2)}</div>
          <p className="nota">
            Correlación entre las reseñas del día 7 y las del día 30. Por eso la regla «reseñas de
            hoy × multiplicador típico» ya es difícil de mejorar, y a día 7 y 14 es el modelo que
            usa el radar.
          </p>
        </div>

        <div className="panel">
          <h3>La opinión temprana cuenta</h3>
          <div className="cifra">{porcentaje(h.positivas_bajas.efecto)}</div>
          <p className="nota">
            Con el mismo volumen a día 7, un juego con el 60 % o menos de reseñas positivas cierra
            el mes por debajo de lo esperado. El juego mediano tiene un{" "}
            {porcentaje(m.mediana_pct_positivas_7d)} de positivas su primera semana.
          </p>
        </div>

        <div className="panel">
          <h3>El precio sube el listón</h3>
          <ul className="barras" aria-label="Mediana de reseñas a 30 días por precio">
            {bandas.map((b) => (
              <li key={b.banda}>
                <span className="barra-etiqueta">{NOMBRE_BANDA[b.banda]}</span>
                <span className="barra-pista">
                  <span className="barra" style={{ width: `${(b.mediana_30d / maximo) * 100}%` }} />
                </span>
                <span className="barra-valor">{entero(b.mediana_30d)}</span>
              </li>
            ))}
          </ul>
          <p className="nota">
            Reseñas a 30 días del juego mediano. Aun así, precio y género solo explican el{" "}
            {porcentaje(h.epsilon2.precio)} y el {porcentaje(h.epsilon2.genero)} de las diferencias:
            antes de lanzar dan un rango, no una cifra.
          </p>
        </div>
      </div>

      <p className="nota">
        Más cifras en <Link href="/mercado">Mercado</Link> y cómo se construyó el modelo en{" "}
        <Link href="/metodologia">Metodología</Link>.
      </p>
    </section>
  );
}
