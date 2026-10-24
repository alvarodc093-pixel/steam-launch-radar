import type { Metadata } from "next";

import Grafico from "@/components/Grafico";
import SinDatos from "@/components/SinDatos";
import { datosMercado } from "@/lib/datos";
import { entero, fecha, NOMBRE_BANDA, porcentaje } from "@/lib/formato";

export const metadata: Metadata = { title: "Mercado" };
export const dynamic = "force-dynamic";

const MOTIVOS: Record<string, string> = {
  apto: "Aptos para el modelo",
  fase_previa_publica: "Tenían reseñas antes de la fecha oficial (acceso anticipado o similar)",
  descarga_incompleta: "Más reseñas de las que se pueden descargar enteras",
  sin_precio_usd: "Sin precio en dólares en la tienda",
  sin_resenas_en_30d: "Ninguna reseña en inglés en su primer mes",
  fuera_del_historico_api: "Lanzados hace más de un año en el momento de la descarga",
};

export default async function PaginaMercado() {
  let m;
  try {
    m = await datosMercado();
  } catch {
    return <SinDatos titulo="Mercado" />;
  }
  const dias = Object.keys(m.fraccion_mediana_del_mes);
  const generos = [...m.por_genero]
    .filter((g) => g.n >= 15)
    .sort((a, b) => b.mediana_30d - a.mediana_30d);
  const orden = ["gratis", "hasta_10", "hasta_20", "hasta_40", "mas_de_40"];
  const bandas = [...m.por_banda].sort((a, b) => orden.indexOf(a.banda) - orden.indexOf(b.banda));

  return (
    <>
      <h1>El primer mes de un lanzamiento en Steam</h1>
      <p className="entradilla">
        Indicadores de la muestra que alimenta el radar: {entero(m.juegos_aptos)} juegos lanzados
        entre el {fecha(m.rango_lanzamientos.desde)} y el {fecha(m.rango_lanzamientos.hasta)}.
      </p>

      <div className="rejilla">
        <div className="panel">
          <div className="etiqueta">Lanzamientos analizados</div>
          <div className="cifra">{entero(m.juegos_aptos)}</div>
          <div className="nota">de {entero(m.juegos_descargados)} descargados</div>
        </div>
        <div className="panel">
          <div className="etiqueta">Reseñas en el primer mes</div>
          <div className="cifra">{entero(m.mediana_resenas_30d)}</div>
          <div className="nota">mediana por juego</div>
        </div>
        <div className="panel">
          <div className="etiqueta">Positivas en la primera semana</div>
          <div className="cifra">{porcentaje(m.mediana_pct_positivas_7d)}</div>
          <div className="nota">mediana por juego</div>
        </div>
        {dias.map((d) => (
          <div className="panel" key={d}>
            <div className="etiqueta">Del mes, el día {d}</div>
            <div className="cifra">{porcentaje(m.fraccion_mediana_del_mes[d])}</div>
            <div className="nota">de las reseñas del primer mes ya han llegado (mediana)</div>
          </div>
        ))}
      </div>

      <h2>¿Cuándo llegan las reseñas del primer mes?</h2>
      <div className="panel">
        <Grafico
          tipo="line"
          etiquetas={m.curva_tipica.map((_, i) => String(i + 1))}
          series={[
            {
              etiqueta: "Fracción acumulada (mediana)",
              valores: m.curva_tipica.map((v) => Math.round(v * 1000) / 10),
              color: "#1e7a52",
            },
          ]}
          ejeX="Día desde el lanzamiento"
          ejeY="% de las reseñas del primer mes"
          resumen={`Las reseñas se concentran al principio: en el juego típico, el día ${dias[1] ?? dias[0]} ya ha llegado el ${porcentaje(m.fraccion_mediana_del_mes[dias[1] ?? dias[0]])} de lo que tendrá al cumplir un mes. Por eso las primeras lecturas anticipan bien el cierre.`}
        />
      </div>

      <h2>¿Qué géneros acumulan más reseñas?</h2>
      <div className="panel">
        <Grafico
          tipo="bar"
          etiquetas={generos.map((g) => `${g.genero} (${g.n})`)}
          series={[
            {
              etiqueta: "Mediana de reseñas a 30 días",
              valores: generos.map((g) => g.mediana_30d),
              color: "#1e7a52",
            },
          ]}
          ejeY="Reseñas a 30 días (mediana)"
          resumen="Mediana de reseñas a 30 días por género principal; entre paréntesis, el número de juegos. Solo géneros con al menos 15 lanzamientos."
        />
      </div>

      <h2>¿Influye el precio?</h2>
      <div className="panel">
        <Grafico
          tipo="bar"
          etiquetas={bandas.map((b) => `${NOMBRE_BANDA[b.banda] ?? b.banda} (${b.n})`)}
          series={[
            {
              etiqueta: "Mediana de reseñas a 30 días",
              valores: bandas.map((b) => b.mediana_30d),
              color: "#2f5bd7",
            },
          ]}
          ejeY="Reseñas a 30 días (mediana)"
          resumen="Mediana de reseñas a 30 días por banda de precio de lista; entre paréntesis, el número de juegos."
        />
      </div>

      <h2>¿Cuántos lanzamientos hay cada mes?</h2>
      <div className="panel">
        <Grafico
          tipo="bar"
          etiquetas={m.por_mes.map((p) => p.mes)}
          series={[
            {
              etiqueta: "Lanzamientos en la muestra",
              valores: m.por_mes.map((p) => p.lanzamientos),
              color: "#8a6d00",
            },
          ]}
          ejeY="Juegos"
          resumen="Lanzamientos de la muestra por mes. Entran los juegos con al menos 50 reseñas el día de la descarga: los lanzados hace menos han tenido menos tiempo para llegar a esa cifra, así que los meses más recientes pueden estar algo infrarrepresentados."
        />
      </div>

      <h2>¿Qué juegos quedan fuera y por qué?</h2>
      <div className="panel tabla">
        <table>
          <tbody>
            {Object.entries(m.exclusiones)
              .sort((a, b) => b[1] - a[1])
              .map(([motivo, n]) => (
                <tr key={motivo}>
                  <th scope="row">{MOTIVOS[motivo] ?? motivo}</th>
                  <td className="num">{entero(n)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
