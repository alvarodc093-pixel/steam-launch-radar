import type { Metadata } from "next";

import SinDatos from "@/components/SinDatos";
import { datosMercado, datosPrevio, datosRadar } from "@/lib/datos";
import { decimal, entero, fecha, porcentaje } from "@/lib/formato";
import type { ModeloJson } from "@/lib/tipos";

export const metadata: Metadata = { title: "Metodología" };
export const dynamic = "force-dynamic";

const NOMBRE_MODELO: Record<string, string> = {
  mediana: "Mediana (sin información)",
  ratio_tipico: "Ratio típico de la muestra",
  ridge: "Regresión Ridge",
  gradient_boosting: "Gradient boosting",
};

function TablaCandidatos({ m }: { m: ModeloJson }) {
  const filas = Object.entries(m.cv_mae_log).sort((a, b) => a[1].mean - b[1].mean);
  return (
    <table>
      <caption>
        Error medio en log (MAE) en validación cruzada temporal dentro del entrenamiento. Se
        elige el menor; el test no interviene.
      </caption>
      <thead>
        <tr>
          <th scope="col">Candidato</th>
          <th scope="col" className="num">MAE (media ± desv.)</th>
        </tr>
      </thead>
      <tbody>
        {filas.map(([nombre, v]) => (
          <tr key={nombre}>
            <th scope="row">
              {NOMBRE_MODELO[nombre] ?? nombre}
              {nombre === m.tipo ? " ✓" : ""}
            </th>
            <td className="num">
              {decimal(v.mean, 3)} ± {decimal(v.std, 3)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function PaginaMetodologia() {
  let radar, previo, mercado;
  try {
    [radar, previo, mercado] = await Promise.all([datosRadar(), datosPrevio(), datosMercado()]);
  } catch {
    return <SinDatos titulo="Metodología" />;
  }
  const dias = radar.dias_lectura;
  const tam = radar.modelos[String(dias[0])].tamanos;
  const pm = previo.modelo;
  const base = pm.baselines_test.mediana;
  // El mismo criterio que usa /api/previo (leerPrevio) para mostrar o no la cifra.
  const previoSupera =
    pm.tipo !== "mediana" &&
    (!base ||
      (pm.metricas_test.mae_log < base.mae_log &&
        pm.metricas_test.mediana_error_log < base.mediana_error_log));

  return (
    <>
      <h1>Cómo funciona</h1>
      <p className="entradilla">
        Qué datos usa la aplicación, cómo se han preparado, cómo se ha evaluado cada modelo y
        qué no puede decir.
      </p>

      <h2>Datos</h2>
      <div className="panel">
        <ul>
          <li>
            <strong>Muestra:</strong> todos los juegos del buscador de la tienda de Steam con
            entre 50 y 10.000 reseñas, lanzados entre el{" "}
            {fecha(mercado.rango_lanzamientos.desde)} y el {fecha(mercado.rango_lanzamientos.hasta)}.
            Quedan {entero(mercado.juegos_aptos)} de {entero(mercado.juegos_descargados)}{" "}
            descargados (los motivos de exclusión están en la pestaña Mercado).
          </li>
          <li>
            <strong>Fecha de lanzamiento y precio:</strong> ficha oficial de la tienda de Steam.
            El precio es el de lista (sin descuento) en dólares.
          </li>
          <li>
            <strong>Reseñas:</strong> las reseñas públicas en inglés de cada juego, vía la API
            de Steam sin clave, agregadas por día. Esa API solo sirve reseñas en inglés y del
            último año, por eso todas las cifras del radar son reseñas en inglés y la muestra
            se limita a lanzamientos de los últimos doce meses. Del texto y del autor no se
            guarda nada.
          </li>
        </ul>
      </div>

      <h2>El radar</h2>
      <div className="panel">
        <p>
          Objetivo: reseñas acumuladas en los 30 primeros días, en escala logarítmica (un error
          de «el doble» pesa lo mismo con 50 reseñas que con 5.000). Variables: reseñas y
          porcentaje de positivas hasta el día de lectura, precio y género; nada posterior a
          ese día. Partición por fecha de lanzamiento: {tam.train} juegos de entrenamiento,{" "}
          {tam.calibracion} de calibración y {tam.test} de test (los más recientes).
        </p>
        <div className="tabla">
          <table>
            <caption>Resultado en test, sobre lanzamientos que el modelo no vio.</caption>
            <thead>
              <tr>
                <th scope="col">Lectura</th>
                <th scope="col">Modelo elegido</th>
                <th scope="col" className="num">Factor de error típico</th>
                <th scope="col" className="num">Dentro de ×2</th>
                <th scope="col" className="num">MAE log</th>
                <th scope="col" className="num">MAE log del ratio típico</th>
                <th scope="col" className="num">Cobertura del 90 %</th>
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => {
                const m = radar.modelos[String(d)];
                const ratio = m.tipo === "ratio_tipico" ? m.metricas_test : m.baselines_test.ratio_tipico;
                return (
                  <tr key={d}>
                    <th scope="row">Día {d}</th>
                    <td>{NOMBRE_MODELO[m.tipo]}</td>
                    <td className="num">×{decimal(m.metricas_test.factor_error_tipico, 2)}</td>
                    <td className="num">{porcentaje(m.metricas_test.dentro_de_x2)}</td>
                    <td className="num">{decimal(m.metricas_test.mae_log, 3)}</td>
                    <td className="num">{ratio ? decimal(ratio.mae_log, 3) : "—"}</td>
                    <td className="num">
                      {m.metricas_test.cobertura_90 !== undefined ? porcentaje(m.metricas_test.cobertura_90) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="nota">
          «Factor de error típico» es la desviación del juego mediano: ×1,5 significa que la
          estimación queda entre dos tercios y vez y media del valor real. El rango del 90 % es
          conformal: el cuantil de los errores en el bloque de calibración.
        </p>
        {dias.map((d) => (
          <details key={d}>
            <summary>Candidatos comparados para el día {d}</summary>
            <div className="tabla">
              <TablaCandidatos m={radar.modelos[String(d)]} />
            </div>
          </details>
        ))}
      </div>

      <h2>Antes de lanzar</h2>
      <div className="panel">
        <p>
          Mismo método con lo que se sabe antes de publicar: precio, género y mes. En test, el
          modelo elegido ({NOMBRE_MODELO[pm.tipo]}) tiene un error medio en log de{" "}
          {decimal(pm.metricas_test.mae_log, 3)} y un error del juego típico de{" "}
          {decimal(pm.metricas_test.mediana_error_log, 3)}; la mediana de la muestra,{" "}
          {base ? `${decimal(base.mae_log, 3)} y ${decimal(base.mediana_error_log, 3)}` : "—"}.{" "}
          {previoSupera
            ? "Mejora en las dos medidas, así que la app muestra su estimación junto al rango de juegos parecidos."
            : "No mejora en las dos a la vez, así que la app no da una cifra antes del lanzamiento: muestra el rango de juegos parecidos."}
        </p>
        <TablaCandidatos m={pm} />
      </div>

      <h2>Limitaciones</h2>
      <div className="panel">
        <ul>
          <li>
            Las reseñas miden actividad, no ventas. Hay juegos que venden mucho con pocas
            reseñas y al revés.
          </li>
          <li>
            Solo entran juegos con al menos 50 reseñas: los lanzamientos que casi nadie jugó
            quedan fuera, y los éxitos con más de 10.000 también, a propósito (el radar es para
            estudios pequeños y medianos).
          </li>
          <li>
            Los juegos que salieron de acceso anticipado se excluyen: su «lanzamiento» no parte
            de cero.
          </li>
          <li>
            El rango del 90 % se cumple en promedio, no en cada juego: uno de cada diez puede
            quedar fuera.
          </li>
        </ul>
      </div>
    </>
  );
}
