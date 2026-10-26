import type { Metadata } from "next";
import Link from "next/link";

import SinDatos from "@/components/SinDatos";
import { datosMercado, datosPrevio, datosRadar, datosVentas } from "@/lib/datos";
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
        Error medio en log (MAE) en validación cruzada temporal dentro del entrenamiento. Se elige
        el menor; el test no interviene.
      </caption>
      <thead>
        <tr>
          <th scope="col">Candidato</th>
          <th scope="col" className="num">
            MAE (media ± desv.)
          </th>
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

const VEREDICTOS = {
  por_encima: "Por encima",
  en_linea: "En línea",
  por_debajo: "Por debajo",
} as const;

export default async function PaginaMetodologia() {
  let radar, previo, mercado;
  try {
    [radar, previo, mercado] = await Promise.all([datosRadar(), datosPrevio(), datosMercado()]);
  } catch {
    return <SinDatos titulo="Metodología" />;
  }
  // Sin ventas.json la página funciona igual: solo se pierde ese contraste.
  const ventas = await datosVentas().catch(() => null);
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
  // «79 de 105 el día 3, 125 de 132 el día 7 y 156 de 156 el día 14»
  const partes = dias.flatMap((d) => {
    const a = radar.aciertos_veredicto[String(d)]?.por_encima;
    if (!a) return [];
    return [`${a.ya_superaba} de ${a.por_encima + a.en_linea + a.por_debajo} el día ${d}`];
  });
  const triviales =
    partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}` : partes.join("");

  return (
    <>
      <h1>Cómo funciona</h1>
      <p className="entradilla">
        Qué datos usa la aplicación, cómo se han preparado, cómo se ha evaluado cada modelo y qué no
        puede decir.
      </p>

      <h2>Datos</h2>
      <div className="panel">
        <ul>
          <li>
            <strong>Muestra:</strong> todos los juegos del buscador de la tienda de Steam con entre
            50 y 10.000 reseñas, lanzados entre el {fecha(mercado.rango_lanzamientos.desde)} y el{" "}
            {fecha(mercado.rango_lanzamientos.hasta)}. Quedan {entero(mercado.juegos_aptos)} de{" "}
            {entero(mercado.juegos_descargados)} descargados (los motivos de exclusión están en la
            pestaña Mercado).
          </li>
          <li>
            <strong>Fecha de lanzamiento y precio:</strong> ficha oficial de la tienda de Steam. El
            precio es el de lista (sin descuento) en dólares.
          </li>
          <li>
            <strong>Reseñas:</strong> las reseñas públicas en inglés de cada juego, vía la API de
            Steam sin clave, agregadas por día. Esa API solo sirve reseñas en inglés y del último
            año, por eso todas las cifras del radar son reseñas en inglés y la muestra se limita a
            lanzamientos de los últimos doce meses. Del texto y del autor no se guarda nada.
          </li>
        </ul>
      </div>

      <h2>El radar</h2>
      <div className="panel">
        <p>
          Objetivo: reseñas acumuladas en los 30 primeros días, en escala logarítmica (un error de
          «el doble» pesa lo mismo con 50 reseñas que con 5.000). Variables: reseñas y porcentaje de
          positivas hasta el día de lectura, precio y género; nada posterior a ese día. Partición
          por fecha de lanzamiento: {tam.train} juegos de entrenamiento, {tam.calibracion} de
          calibración y {tam.test} de test (los más recientes).
        </p>
        <div className="tabla">
          <table>
            <caption>Resultado en test, sobre lanzamientos que el modelo no vio.</caption>
            <thead>
              <tr>
                <th scope="col">Lectura</th>
                <th scope="col">Modelo elegido</th>
                <th scope="col" className="num">
                  Factor de error típico
                </th>
                <th scope="col" className="num">
                  Dentro de ×2
                </th>
                <th scope="col" className="num">
                  MAE log
                </th>
                <th scope="col" className="num">
                  MAE log del ratio típico
                </th>
                <th scope="col" className="num">
                  Cobertura del 90 %
                </th>
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => {
                const m = radar.modelos[String(d)];
                const ratio =
                  m.tipo === "ratio_tipico" ? m.metricas_test : m.baselines_test.ratio_tipico;
                return (
                  <tr key={d}>
                    <th scope="row">Día {d}</th>
                    <td>{NOMBRE_MODELO[m.tipo]}</td>
                    <td className="num">×{decimal(m.metricas_test.factor_error_tipico, 2)}</td>
                    <td className="num">{porcentaje(m.metricas_test.dentro_de_x2)}</td>
                    <td className="num">{decimal(m.metricas_test.mae_log, 3)}</td>
                    <td className="num">{ratio ? decimal(ratio.mae_log, 3) : "—"}</td>
                    <td className="num">
                      {m.metricas_test.cobertura_90 !== undefined
                        ? porcentaje(m.metricas_test.cobertura_90)
                        : "—"}
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

      <h2>¿Acierta el veredicto?</h2>
      <div className="panel">
        <p>
          Cada juego del test, leído como lo haría la app, frente a dónde acabó de verdad a los 30
          días dentro de su cohorte: por encima de tres de cada cuatro juegos parecidos, en la mitad
          central o por debajo.
        </p>
        <div className="tabla">
          <table>
            <caption>Veredicto del radar y posición real a 30 días, en los juegos de test.</caption>
            <thead>
              <tr>
                <th scope="col">Lectura</th>
                <th scope="col">Veredicto</th>
                <th scope="col" className="num">
                  Juegos
                </th>
                <th scope="col" className="num">
                  Acabó por encima
                </th>
                <th scope="col" className="num">
                  En la mitad central
                </th>
                <th scope="col" className="num">
                  Acabó por debajo
                </th>
              </tr>
            </thead>
            <tbody>
              {dias.flatMap((d) =>
                (["por_encima", "en_linea", "por_debajo"] as const).flatMap((v) => {
                  const a = radar.aciertos_veredicto[String(d)]?.[v];
                  if (!a) return [];
                  const n = a.por_encima + a.en_linea + a.por_debajo;
                  return [
                    <tr key={`${d}-${v}`}>
                      <th scope="row">Día {d}</th>
                      <td>{VEREDICTOS[v]}</td>
                      <td className="num">{entero(n)}</td>
                      <td className="num">{porcentaje(a.por_encima / n)}</td>
                      <td className="num">{porcentaje(a.en_linea / n)}</td>
                      <td className="num">{porcentaje(a.por_debajo / n)}</td>
                    </tr>,
                  ];
                }),
              )}
            </tbody>
          </table>
        </div>
        <p className="nota" style={{ marginBottom: 0 }}>
          Cuando dice «por debajo» casi siempre acierta, y ahí está su valor: avisa de un mal mes
          cuando todavía hay tiempo de reaccionar. Los «por encima» también aciertan, pero en la
          mayoría el juego ya tenía, el día de la lectura, más reseñas de las que tres de cada
          cuatro juegos parecidos alcanzan en un mes ({triviales}): el veredicto lo confirma, pero
          el modelo apenas añade información.
        </p>
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

      {ventas && (
        <>
          <h2>Contraste con ventas anunciadas</h2>
          <div className="panel">
            <p>
              Steam no publica ventas, así que el radar trabaja con reseñas. Para comprobar que son
              una buena aproximación, se cruzan las {ventas.resumen.cifras} cifras de ventas
              oficiales que anunciaron los estudios de {ventas.resumen.juegos} juegos de la muestra
              con las reseñas en inglés que llevaba cada juego ese mismo día. La proporción solo se
              compara cuando se sabe qué parte de las ventas es de PC: las de consola no dejan
              reseñas en Steam.
            </p>
            <div className="rejilla">
              <div>
                <div className="etiqueta">Copias de PC por reseña, al lanzamiento</div>
                <div className="cifra">{entero(ventas.resumen.lanzamiento.mediana)}</div>
                <div className="nota">
                  mediana de {ventas.resumen.lanzamiento.juegos} juegos (de{" "}
                  {entero(ventas.resumen.lanzamiento.minimo)} a{" "}
                  {entero(ventas.resumen.lanzamiento.maximo)}) en sus dos primeras semanas
                </div>
              </div>
              <div>
                <div className="etiqueta">A partir de la cuarta semana</div>
                <div className="cifra">{entero(ventas.resumen.despues_del_primer_mes.mediana)}</div>
                <div className="nota">
                  mediana de {ventas.resumen.despues_del_primer_mes.juegos} juegos (de{" "}
                  {entero(ventas.resumen.despues_del_primer_mes.minimo)} a{" "}
                  {entero(ventas.resumen.despues_del_primer_mes.maximo)}): baja a medida que llegan
                  las reseñas, pero varía mucho entre juegos
                </div>
              </div>
            </div>
            <div className="tabla" style={{ marginTop: "1rem" }}>
              <table>
                <caption>
                  Cifras oficiales y reseñas en inglés en Steam hasta el día del anuncio.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Juego</th>
                    <th scope="col" className="num">
                      Día
                    </th>
                    <th scope="col" className="num">
                      Copias anunciadas
                    </th>
                    <th scope="col">Plataformas</th>
                    <th scope="col" className="num">
                      Reseñas en inglés
                    </th>
                    <th scope="col" className="num">
                      Copias de PC por reseña
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...ventas.juegos]
                    .sort((a, b) => a.dia - b.dia)
                    .map((v) => (
                      <tr key={`${v.appid}-${v.dia}`}>
                        <th scope="row">
                          <a href={v.url} target="_blank" rel="noreferrer">
                            {v.nombre}
                          </a>
                        </th>
                        <td className="num">
                          {v.fecha_aproximada ? "~" : ""}
                          {v.dia}
                        </td>
                        <td className="num">{entero(v.unidades)}</td>
                        <td>{v.plataformas}</td>
                        <td className="num">{entero(v.resenas_ingles)}</td>
                        <td className="num">
                          {v.copias_pc_por_resena === null ? "—" : entero(v.copias_pc_por_resena)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="nota" style={{ marginBottom: 0 }}>
              Al estrenarse, muchos compran y aún no han jugado lo bastante para reseñar, así que la
              proporción es alta y baja con el tiempo. Pero varía mucho de un juego a otro: a partir
              de la cuarta semana va de {entero(ventas.resumen.despues_del_primer_mes.minimo)} a{" "}
              {entero(ventas.resumen.despues_del_primer_mes.maximo)} copias por reseña. Una
              explicación probable es el idioma: solo se cuentan reseñas en inglés, y un juego con
              mucho público en otros idiomas vende más copias por cada una. Las reseñas dan el orden
              de magnitud de las ventas, no una cifra fiable, y estos son solo juegos que
              triunfaron: los estudios pequeños no publican sus ventas.
            </p>
          </div>
        </>
      )}

      <h2>Limitaciones</h2>
      <div className="panel">
        <ul>
          <li>
            Las reseñas miden actividad, no ventas. Steam no publica las ventas de ningún juego, y
            las cifras que circulan son estimaciones, casi siempre calculadas a partir de las
            propias reseñas: usarlas no añadiría información. Hay juegos que venden mucho con pocas
            reseñas y al revés.
          </li>
          <li>
            Solo entran juegos con al menos 50 reseñas: los lanzamientos que casi nadie jugó quedan
            fuera, y los éxitos con más de 10.000 también, a propósito (el radar es para estudios
            pequeños y medianos).
          </li>
          <li>
            Los juegos que salieron de acceso anticipado se excluyen: su «lanzamiento» no parte de
            cero.
          </li>
          <li>
            El rango del 90 % se cumple en promedio, no en cada juego: uno de cada diez puede quedar
            fuera.
          </li>
        </ul>
      </div>

      <h2>Asistente y panel de Power BI</h2>
      <div className="rejilla">
        <div className="panel">
          <h3>Asistente (RAG)</h3>
          <p className="nota">
            La página <Link href="/asistente">Asistente</Link> recupera fragmentos del README, de
            los notebooks y de una ficha por juego (BM25, y embeddings cuando están disponibles) y
            un modelo de Ollama redacta la respuesta citándolos. Se evalúa con 43 preguntas de
            referencia; en las 16 de reserva, escritas después de ajustar la búsqueda, responde bien
            las 10 directas con búsqueda híbrida, 3 de las 6 formuladas con otras palabras, y
            rechaza las ajenas al proyecto.
          </p>
        </div>
        <div className="panel">
          <h3>Panel de Power BI</h3>
          <p className="nota">
            El repositorio incluye un proyecto de Power BI (<code>powerbi/</code>) con un modelo en
            estrella y cuatro páginas: mercado, ritmo del primer mes, calidad del modelo y detalle
            por juego. Se genera desde Python con los mismos datos y un test comprueba que sus
            métricas coinciden con las de esta página.
          </p>
        </div>
      </div>
    </>
  );
}
