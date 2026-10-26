/** Evaluación en TypeScript de los modelos exportados desde Python.

Repite exactamente `preparar_variables` (radar/modelo.py) y el pipeline de
scikit-learn: imputación con la mediana del train, escalado si lo hay,
one-hot de género y, después, Ridge, árboles de gradient boosting o uno de
los dos baselines. `tests/modelo.test.ts` lo contrasta con predicciones
calculadas en Python.
*/

import type { EntradaPrevia, EntradaRadar, ModeloJson } from "./tipos.ts";

type Fila = Record<string, number | string | null>;

/** Variables derivadas, igual que en Python. */
export function variablesRadar(e: EntradaRadar, generos: string[]): Fila {
  const s = e.senales ?? {};
  const horas = s.horas_resena;
  return {
    [`log_resenas_${e.dia}d`]: Math.log1p(e.resenas),
    [`pct_positivas_${e.dia}d`]: e.pct_positivas,
    log_precio: Math.log1p(e.precio_usd),
    gratis: e.precio_usd === 0 ? 1 : 0,
    genero: generos.includes(e.genero) ? e.genero : "Otros",
    // Las mismas transformaciones que modelo.preparar_variables en Python.
    [`pct_compra_steam_${e.dia}d`]: s.pct_compra_steam ?? null,
    [`pct_gratis_${e.dia}d`]: s.pct_gratis ?? null,
    [`pct_deck_${e.dia}d`]: s.pct_deck ?? null,
    [`log_horas_resena_${e.dia}d`]: typeof horas === "number" ? Math.log1p(horas) : null,
  };
}

export function variablesPrevias(e: EntradaPrevia, generos: string[]): Fila {
  return {
    log_precio: Math.log1p(e.precio_usd),
    gratis: e.precio_usd === 0 ? 1 : 0,
    mes_lanzamiento: e.mes_lanzamiento,
    genero: generos.includes(e.genero) ? e.genero : "Otros",
  };
}

function vector(m: ModeloJson, fila: Fila): number[] {
  const x: number[] = [];
  for (const col of m.numericas) {
    const bruto = fila[col];
    let v = typeof bruto === "number" && Number.isFinite(bruto) ? bruto : m.medianas![col];
    if (m.medias && m.escalas) v = (v - m.medias[col]) / m.escalas[col];
    x.push(v);
  }
  for (const col of m.categoricas) {
    for (const categoria of m.categorias![col]) x.push(fila[col] === categoria ? 1 : 0);
  }
  return x;
}

/** Predicción en log1p(reseñas a 30 días). */
export function predecirLog(m: ModeloJson, fila: Fila): number {
  switch (m.tipo) {
    case "mediana":
      return m.mediana!;
    case "ratio_tipico":
      return (fila[m.ratio!.columna] as number) + m.ratio!.desplazamiento;
    case "ridge": {
      const x = vector(m, fila);
      return x.reduce((suma, v, i) => suma + v * m.ridge!.coef[i], m.ridge!.intercepto);
    }
    case "gradient_boosting": {
      const x = vector(m, fila);
      let total = m.gb!.inicial;
      for (const a of m.gb!.arboles) {
        let nodo = 0;
        while (a.izq[nodo] !== -1) {
          nodo = x[a.variable[nodo]] <= a.umbral[nodo] ? a.izq[nodo] : a.der[nodo];
        }
        total += m.gb!.tasa * a.valor[nodo];
      }
      return total;
    }
  }
}

export interface Estimacion {
  central: number;
  inferior: number;
  superior: number;
}

/** Reseñas a 30 días con el intervalo conformal del 90 %. */
export function estimar(m: ModeloJson, fila: Fila, minimo = 0): Estimacion {
  const log = predecirLog(m, fila);
  return {
    central: Math.max(minimo, Math.expm1(log)),
    inferior: Math.max(minimo, Math.expm1(log - m.q90)),
    superior: Math.max(minimo, Math.expm1(log + m.q90)),
  };
}

/** Percentil aproximado de `valor` dentro de unos cuantiles conocidos. */
export function percentil(valor: number, niveles: number[], cuantiles: number[]): number {
  if (valor <= cuantiles[0]) return niveles[0];
  for (let i = 1; i < cuantiles.length; i++) {
    if (valor <= cuantiles[i]) {
      const tramo = cuantiles[i] - cuantiles[i - 1];
      const t = tramo > 0 ? (valor - cuantiles[i - 1]) / tramo : 1;
      return niveles[i - 1] + t * (niveles[i] - niveles[i - 1]);
    }
  }
  return niveles[niveles.length - 1];
}
