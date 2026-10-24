/** Lectura del radar: estimación a 30 días y comparación con juegos parecidos. */

import { estimar, percentil, variablesPrevias, variablesRadar, type Estimacion } from "./modelo.ts";
import type { DatosPrevio, DatosRadar, EntradaPrevia, EntradaRadar } from "./tipos.ts";

export type Veredicto = "por_encima" | "en_linea" | "por_debajo";

export interface LecturaRadar {
  estimacion: Estimacion;
  cohorte: { nombre: string; n: number; cuantiles30d: number[] };
  percentilLectura: number;
  percentilEstimacion: number;
  veredicto: Veredicto;
  trayectoria: number[];
  modelo: { tipo: string; factorError: number; cobertura: number | undefined; nTest: number };
}

/** Cohorte del género si hay juegos suficientes; si no, toda la muestra. */
function cohorte(datos: DatosRadar, genero: string) {
  const propia = datos.cohortes.por_genero[genero];
  if (propia) {
    return { nombre: genero, n: propia.n as number, tabla: propia as Record<string, number[]> };
  }
  return { nombre: "toda la muestra", n: datos.cohortes.n_global, tabla: datos.cohortes.global };
}

/**
 * El veredicto mira el intervalo entero, no solo la cifra central: solo se
 * dice «por debajo» si incluso el extremo optimista queda bajo el cuartil
 * inferior de su cohorte (y al revés para «por encima»).
 */
export function veredicto(est: Estimacion, cuantiles30d: number[]): Veredicto {
  const [, q25, , q75] = cuantiles30d;
  if (est.superior < q25) return "por_debajo";
  if (est.inferior > q75) return "por_encima";
  return "en_linea";
}

export function leerRadar(datos: DatosRadar, e: EntradaRadar): LecturaRadar {
  const modelo = datos.modelos[String(e.dia)];
  // Al mes no puede haber menos reseñas de las que ya hay el día de lectura.
  const est = estimar(modelo, variablesRadar(e, modelo.generos), e.resenas);
  const c = cohorte(datos, e.genero);
  const niveles = datos.cohortes.cuantiles;
  const cuantiles30d = c.tabla["30"];
  const curva = datos.curva_tipica[c.nombre] ?? datos.curva_tipica.global;
  return {
    estimacion: est,
    cohorte: { nombre: c.nombre, n: c.n, cuantiles30d },
    percentilLectura: percentil(e.resenas, niveles, c.tabla[String(e.dia)]),
    percentilEstimacion: percentil(est.central, niveles, cuantiles30d),
    veredicto: veredicto(est, cuantiles30d),
    trayectoria: curva.map((f) => f * est.central),
    modelo: {
      tipo: modelo.tipo,
      factorError: modelo.metricas_test.factor_error_tipico,
      cobertura: modelo.metricas_test.cobertura_90,
      nTest: modelo.tamanos.test,
    },
  };
}

export interface LecturaPrevia {
  estimacion: Estimacion;
  superaBaseline: boolean;
  benchmark: { genero: string; banda: string | null; n: number; cuantiles: number[] } | null;
}

export function leerPrevio(datos: DatosPrevio, e: EntradaPrevia, banda: string): LecturaPrevia {
  const m = datos.modelo;
  const base = m.baselines_test.mediana;
  const exacta = datos.genero_banda.find((g) => g.genero === e.genero && g.banda === banda);
  const genero = datos.por_genero.find((g) => g.genero === e.genero);
  // Con menos de 10 juegos los cuartiles bailan demasiado: se sube un nivel.
  const benchmark =
    exacta && exacta.n >= 10
      ? { genero: e.genero, banda, n: exacta.n, cuantiles: exacta.cuantiles }
      : genero
        ? { genero: e.genero, banda: null, n: genero.n, cuantiles: genero.cuantiles }
        : null;
  return {
    estimacion: estimar(m, variablesPrevias(e, m.generos)),
    // Tiene que mejorar a la mediana en el error medio y también en el del
    // juego típico: bajar solo el medio puede deberse a unos pocos aciertos
    // en juegos extremos mientras empeora el caso normal.
    superaBaseline:
      m.tipo !== "mediana" &&
      (!base ||
        (m.metricas_test.mae_log < base.mae_log &&
          m.metricas_test.mediana_error_log < base.mediana_error_log)),
    benchmark,
  };
}
