/** Lectura en directo: ficha y reseñas de un lanzamiento, pedidas a Steam al momento.

Reproduce las reglas de la ingesta y la preparación de Python (radar/ingesta y
radar/preparacion.py) para un solo juego: días UTC relativos a la fecha de
lanzamiento, género principal sin los genéricos y precio de lista en dólares.
Así un estudio puede leer su juego sin copiar cifras a mano.
*/

import type { Senales } from "./tipos.ts";

export const URL_FICHA = "https://store.steampowered.com/api/appdetails";
export const URL_RESENAS = "https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/";
const TODO_EL_HISTORICO = "9223372036854775807";
// Un juego en su primer mes con más de 6.000 reseñas está muy por encima de
// la muestra del radar (como mucho 10.000 en el mes): no hace falta recorrerlo.
const MAX_PAGINAS = 60;
const GENEROS_GENERICOS = new Set(["Indie", "Early Access", "Free To Play", "Free to Play"]);
const MESES: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const DIA_MS = 86_400_000;

export interface FichaSteam {
  appid: number;
  nombre: string;
  fechaLanzamiento: string; // AAAA-MM-DD
  precioUsd: number | null;
  generos: string[];
  generoPrincipal: string;
}

export interface DiaResenas {
  dia: number;
  positivas: number;
  negativas: number;
  // Señales tempranas, contadas como en radar/ingesta/resenas.py.
  compraSteam: number;
  gratis: number;
  deck: number;
  horasLog: number; // suma de log(1 + horas jugadas al reseñar)
}

/** El appid de un número suelto o de un enlace de la tienda. */
export function appidDe(texto: string): number | null {
  const limpio = texto.trim();
  const enlace = limpio.match(/store\.steampowered\.com\/app\/(\d+)/);
  const numero = enlace ? enlace[1] : /^\d{1,9}$/.test(limpio) ? limpio : null;
  return numero ? Number(numero) : null;
}

/** «Oct 24, 2026» o «24 Oct, 2026» a AAAA-MM-DD; null sin día exacto. */
export function fechaSteam(texto: string | undefined): string | null {
  if (!texto) return null;
  const partes = texto.replace(",", "").replace("Sept", "Sep").trim().split(/\s+/);
  if (partes.length !== 3) return null;
  const [a, b, anio] = partes;
  const [mes, dia] = /^\d+$/.test(a) ? [b, a] : [a, b];
  const m = MESES[mes.slice(0, 3).toLowerCase()];
  if (m === undefined || !/^\d+$/.test(dia) || !/^\d{4}$/.test(anio)) return null;
  return new Date(Date.UTC(Number(anio), m, Number(dia))).toISOString().slice(0, 10);
}

export function generoPrincipal(generos: string[]): string {
  return generos.find((g) => !GENEROS_GENERICOS.has(g)) ?? generos[0] ?? "Sin género";
}

// Solo los campos de las respuestas de Steam que se usan.
interface DatosFicha {
  type?: string;
  name?: string;
  is_free?: boolean;
  release_date?: { date?: string; coming_soon?: boolean };
  price_overview?: { currency?: string; initial?: number };
  genres?: { description?: string }[];
}
interface ResenaSteam {
  recommendationid?: string;
  timestamp_created?: number;
  voted_up?: boolean;
  steam_purchase?: boolean;
  received_for_free?: boolean;
  primarily_steam_deck?: boolean;
  author?: { playtime_at_review?: number };
}

/** Ficha de la tienda, o null si no existe o no es un juego. */
export function parsearFicha(appid: number, respuesta: unknown): FichaSteam | null {
  const bloque = (respuesta as Record<string, { success?: boolean; data?: DatosFicha }> | null)?.[
    String(appid)
  ];
  const datos = bloque?.success ? bloque.data : undefined;
  if (!datos || datos.type !== "game") return null;
  const fechaLanzamiento = fechaSteam(datos.release_date?.date);
  if (!fechaLanzamiento || datos.release_date?.coming_soon) return null;
  const precio = datos.price_overview;
  const precioUsd = datos.is_free
    ? 0
    : precio?.currency === "USD" && Number.isInteger(precio.initial)
      ? (precio.initial as number) / 100
      : null;
  const generos = (datos.genres ?? []).flatMap((g) => (g.description ? [g.description] : []));
  return {
    appid,
    nombre: String(datos.name ?? appid),
    fechaLanzamiento,
    precioUsd,
    generos,
    generoPrincipal: generoPrincipal(generos),
  };
}

/** Reseñas por día relativo al lanzamiento (0 = día del lanzamiento, en UTC). */
export function agregarPorDia(resenas: ResenaSteam[], fechaLanzamiento: string): DiaResenas[] {
  const inicio = Date.parse(`${fechaLanzamiento}T00:00:00Z`);
  const dias = new Map<number, DiaResenas>();
  for (const r of resenas) {
    if (typeof r.timestamp_created !== "number" || typeof r.voted_up !== "boolean") continue;
    const dia = Math.floor((r.timestamp_created * 1000 - inicio) / DIA_MS);
    const d = dias.get(dia) ?? {
      dia,
      positivas: 0,
      negativas: 0,
      compraSteam: 0,
      gratis: 0,
      deck: 0,
      horasLog: 0,
    };
    if (r.voted_up) d.positivas++;
    else d.negativas++;
    if (r.steam_purchase === true) d.compraSteam++;
    if (r.received_for_free === true) d.gratis++;
    if (r.primarily_steam_deck === true) d.deck++;
    const minutos = r.author?.playtime_at_review;
    if (typeof minutos === "number" && minutos >= 0) d.horasLog += Math.log1p(minutos / 60);
    dias.set(dia, d);
  }
  return [...dias.values()].sort((a, b) => a.dia - b.dia);
}

/**
 * Día de lectura que corresponde hoy: el mayor de `diasLectura` ya completo.
 * El día 7 se lee con las reseñas de los días 0 a 6, así que hace falta que
 * hayan pasado 7 días enteros desde el lanzamiento.
 */
export function diaDeLectura(
  fechaLanzamiento: string,
  ahora: Date,
  diasLectura: number[],
): { completos: number; dia: number | null } {
  const inicio = Date.parse(`${fechaLanzamiento}T00:00:00Z`);
  const completos = Math.floor((ahora.getTime() - inicio) / DIA_MS);
  const dia = [...diasLectura].sort((a, b) => b - a).find((d) => d <= completos) ?? null;
  return { completos, dia };
}

/**
 * Parte de las reseñas anteriores a la fecha oficial. Por encima del 5 % el
 * juego tuvo una fase pública previa (acceso anticipado) y el radar no aplica,
 * el mismo criterio que la preparación de los datos.
 */
export const MAX_PCT_PREVIAS = 0.05;
export function pctPrevias(dias: DiaResenas[]): number {
  let previas = 0;
  let total = 0;
  for (const d of dias) {
    total += d.positivas + d.negativas;
    if (d.dia < 0) previas += d.positivas + d.negativas;
  }
  return total > 0 ? previas / total : 0;
}

/**
 * Reseñas, proporción de positivas y señales tempranas de los días 0 a
 * `dia` − 1, con las mismas fórmulas que preparacion.senales_tempranas.
 */
export function lecturaHasta(dias: DiaResenas[], dia: number) {
  const suma = { positivas: 0, total: 0, compraSteam: 0, gratis: 0, deck: 0, horas: 0 };
  for (const d of dias) {
    if (d.dia < 0 || d.dia >= dia) continue;
    suma.positivas += d.positivas;
    suma.total += d.positivas + d.negativas;
    suma.compraSteam += d.compraSteam;
    suma.gratis += d.gratis;
    suma.deck += d.deck;
    suma.horas += d.horasLog;
  }
  const n = suma.total;
  const parte = (v: number) => (n > 0 ? v / n : null);
  const senales: Senales = {
    pct_compra_steam: parte(suma.compraSteam),
    pct_gratis: parte(suma.gratis),
    pct_deck: parte(suma.deck),
    horas_resena: n > 0 ? Math.expm1(suma.horas / n) : null,
  };
  return { resenas: n, pctPositivas: parte(suma.positivas), senales };
}

async function pedirJson(url: string, parametros: Record<string, string>): Promise<unknown> {
  const r = await fetch(`${url}?${new URLSearchParams(parametros)}`, {
    headers: { "User-Agent": "steam-launch-radar/1.0" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Steam respondió ${r.status}`);
  return r.json();
}

export async function descargarFicha(appid: number): Promise<FichaSteam | null> {
  return parsearFicha(
    appid,
    await pedirJson(URL_FICHA, { appids: String(appid), cc: "us", l: "english" }),
  );
}

/**
 * Todas las reseñas del juego por día. Steam no las sirve en orden estricto de
 * fecha, así que hay que recorrerlas enteras, como hace la ingesta. La API
 * solo devuelve las de inglés.
 */
export async function descargarResenas(
  appid: number,
  fechaLanzamiento: string,
): Promise<{ dias: DiaResenas[]; completo: boolean }> {
  const parametros: Record<string, string> = {
    appid: String(appid),
    filter: "recent",
    language: "all",
    purchase_type: "all",
    day_range: TODO_EL_HISTORICO,
    num_per_page: "100",
    cursor: "*",
  };
  const vistas = new Map<string, ResenaSteam>();
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const datos = (await pedirJson(URL_RESENAS, parametros)) as {
      response?: { reviews?: ResenaSteam[]; cursor?: string };
    };
    const lote = datos.response?.reviews ?? [];
    for (const r of lote) vistas.set(String(r.recommendationid), r);
    const cursor = datos.response?.cursor;
    if (!lote.length || !cursor || cursor === parametros.cursor) {
      return { dias: agregarPorDia([...vistas.values()], fechaLanzamiento), completo: true };
    }
    parametros.cursor = cursor;
  }
  return { dias: agregarPorDia([...vistas.values()], fechaLanzamiento), completo: false };
}
