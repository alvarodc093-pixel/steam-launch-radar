/** Alertas del radar: qué avisar de un juego seguido según su lectura de hoy.

El estado de cada juego se guarda en su issue de GitHub, en un comentario HTML
invisible, así que el workflow no necesita base de datos ni escribir en el
repositorio (ver scripts/seguimiento.ts).
*/

import type { Veredicto } from "./radar.ts";

export interface Estado {
  dia: number;
  veredicto: Veredicto;
}

export type Accion =
  | { tipo: "nada" }
  | { tipo: "abrir" | "comentar"; texto: string; estado: Estado }
  | { tipo: "cerrar"; texto: string };

const NOMBRE: Record<Veredicto, string> = {
  por_encima: "por encima de lo habitual",
  en_linea: "dentro de lo habitual",
  por_debajo: "por debajo de lo habitual",
};
const MARCA = /<!-- radar:(\w+):(\d+) -->/g;

/** Último estado guardado en el texto del issue y sus comentarios. */
export function ultimoEstado(textos: string[]): Estado | null {
  let estado: Estado | null = null;
  for (const t of textos) {
    for (const m of t.matchAll(MARCA)) estado = { veredicto: m[1] as Veredicto, dia: Number(m[2]) };
  }
  return estado;
}

export function marca(e: Estado): string {
  return `<!-- radar:${e.veredicto}:${e.dia} -->`;
}

/**
 * Qué hacer con un juego dada su lectura de hoy y lo último que se avisó.
 * `real30d` llega cuando el juego ya cumplió el mes.
 */
export function decidir(
  anterior: Estado | null,
  hoy: { estado: Estado; central: number; inferior: number; superior: number } | null,
  real30d: number | null,
): Accion {
  if (real30d !== null) {
    if (!anterior) return { tipo: "nada" }; // nunca se siguió: no hay nada que cerrar
    return {
      tipo: "cerrar",
      texto: `Cumplió el primer mes con **${real30d}** reseñas. La última lectura (día ${anterior.dia}) decía «${NOMBRE[anterior.veredicto]}».`,
    };
  }
  if (!hoy) return { tipo: "nada" };
  const cifra = `unas ${Math.round(hoy.central)} reseñas a 30 días (rango del 90 %: ${Math.round(hoy.inferior)}–${Math.round(hoy.superior)})`;
  const texto = (encabezado: string) =>
    `${encabezado}\n\nLectura del día ${hoy.estado.dia}: **${NOMBRE[hoy.estado.veredicto]}**, ${cifra}.\n\n${marca(hoy.estado)}`;
  if (!anterior)
    return { tipo: "abrir", texto: texto("Empieza el seguimiento."), estado: hoy.estado };
  if (anterior.veredicto !== hoy.estado.veredicto) {
    return {
      tipo: "comentar",
      texto: texto(
        `**Cambio de veredicto**: era «${NOMBRE[anterior.veredicto]}» el día ${anterior.dia}.`,
      ),
      estado: hoy.estado,
    };
  }
  if (anterior.dia !== hoy.estado.dia) {
    return { tipo: "comentar", texto: texto("Sin cambios de veredicto."), estado: hoy.estado };
  }
  return { tipo: "nada" };
}
