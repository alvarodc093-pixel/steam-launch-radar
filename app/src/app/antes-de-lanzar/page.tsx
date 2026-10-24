import type { Metadata } from "next";

import FormularioPrevio from "@/components/FormularioPrevio";
import SinDatos from "@/components/SinDatos";
import { datosPrevio } from "@/lib/datos";
import { entero, NOMBRE_BANDA } from "@/lib/formato";

export const metadata: Metadata = { title: "Antes de lanzar" };
export const dynamic = "force-dynamic";

export default async function PaginaPrevia() {
  let previo;
  try {
    previo = await datosPrevio();
  } catch {
    return <SinDatos titulo="Antes de lanzar" />;
  }
  const generos = previo.por_genero
    .filter((g) => g.n >= 10)
    .map((g) => g.genero)
    .sort((a, b) => a.localeCompare(b, "es"));
  const orden = ["gratis", "hasta_10", "hasta_20", "hasta_40", "mas_de_40"];
  const bandas = [...previo.por_banda].sort(
    (a, b) => orden.indexOf(a.banda) - orden.indexOf(b.banda),
  );

  return (
    <>
      <h1>Antes de lanzar: ¿qué es normal para un juego como el tuyo?</h1>
      <p className="entradilla">
        Antes de publicar no hay reseñas que mirar, pero sí juegos parecidos que ya pasaron por su
        primer mes. Esta pantalla te da ese punto de referencia para fijar expectativas.
      </p>
      <FormularioPrevio generos={generos} />

      <h2>Reseñas en el primer mes según el precio</h2>
      <div className="panel tabla">
        <table>
          <caption>
            {entero(previo.global.n)} lanzamientos de la muestra. Mediana y mitad central (del
            percentil 25 al 75) de las reseñas a 30 días.
          </caption>
          <thead>
            <tr>
              <th scope="col">Precio</th>
              <th scope="col" className="num">
                Juegos
              </th>
              <th scope="col" className="num">
                Mediana
              </th>
              <th scope="col" className="num">
                Mitad central
              </th>
            </tr>
          </thead>
          <tbody>
            {bandas.map((b) => (
              <tr key={b.banda}>
                <th scope="row">{NOMBRE_BANDA[b.banda] ?? b.banda}</th>
                <td className="num">{b.n}</td>
                <td className="num">{entero(b.cuantiles[2])}</td>
                <td className="num">
                  {entero(b.cuantiles[1])} – {entero(b.cuantiles[3])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="nota">
        Las bandas se solapan mucho: dentro de cada precio hay juegos que no pasan de unas decenas
        de reseñas y otros con miles. Por eso el precio y el género sirven como contexto, no como
        predicción.
      </p>
    </>
  );
}
