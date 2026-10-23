/** Validación de las entradas de la API, con mensajes que entiende el usuario. */

import type { EntradaPrevia, EntradaRadar } from "./tipos.ts";

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

function numero(nombre: string, v: unknown, min: number, max: number, errores: string[]): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errores.push(`${nombre}: tiene que ser un número`);
    return Number.NaN;
  }
  if (v < min || v > max) errores.push(`${nombre}: entre ${min} y ${max}`);
  return v;
}

function texto(nombre: string, v: unknown, errores: string[]): string {
  if (typeof v !== "string" || !v.trim() || v.length > 60) {
    errores.push(`${nombre}: elige un valor de la lista`);
    return "";
  }
  return v.trim();
}

function objeto(cuerpo: unknown): Record<string, unknown> | null {
  return typeof cuerpo === "object" && cuerpo !== null && !Array.isArray(cuerpo)
    ? (cuerpo as Record<string, unknown>)
    : null;
}

export function validarRadar(cuerpo: unknown, diasValidos: number[]): Resultado<EntradaRadar> {
  const c = objeto(cuerpo);
  if (!c) return { ok: false, error: "El cuerpo tiene que ser un objeto JSON." };
  const errores: string[] = [];
  const dia = numero("dia", c.dia, 0, 30, errores);
  if (!errores.length && !diasValidos.includes(dia)) {
    errores.push(`dia: el radar lee los días ${diasValidos.join(", ")}`);
  }
  const resenas = numero("resenas", c.resenas, 0, 1_000_000, errores);
  if (Number.isFinite(resenas) && !Number.isInteger(resenas)) errores.push("resenas: número entero");
  let pct: number | null = null;
  if (c.pct_positivas !== null && c.pct_positivas !== undefined) {
    pct = numero("pct_positivas", c.pct_positivas, 0, 1, errores);
  }
  const precio = numero("precio_usd", c.precio_usd, 0, 200, errores);
  const genero = texto("genero", c.genero, errores);
  if (errores.length) return { ok: false, error: errores.join("; ") };
  // Sin reseñas no hay porcentaje de positivas que valga.
  return {
    ok: true,
    valor: { dia, resenas, pct_positivas: resenas === 0 ? null : pct, precio_usd: precio, genero },
  };
}

export function validarPrevio(cuerpo: unknown): Resultado<EntradaPrevia> {
  const c = objeto(cuerpo);
  if (!c) return { ok: false, error: "El cuerpo tiene que ser un objeto JSON." };
  const errores: string[] = [];
  const precio = numero("precio_usd", c.precio_usd, 0, 200, errores);
  const mes = numero("mes_lanzamiento", c.mes_lanzamiento, 1, 12, errores);
  if (Number.isFinite(mes) && !Number.isInteger(mes)) errores.push("mes_lanzamiento: de 1 a 12");
  const genero = texto("genero", c.genero, errores);
  if (errores.length) return { ok: false, error: errores.join("; ") };
  return { ok: true, valor: { precio_usd: precio, mes_lanzamiento: mes, genero } };
}
