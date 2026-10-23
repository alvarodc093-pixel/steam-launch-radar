/** Lectura de los JSON exportados (solo en el servidor). */

import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DatosMercado, DatosPrevio, DatosRadar } from "./tipos";

const DIR = path.join(process.cwd(), "data");
const cache = new Map<string, Promise<unknown>>();

function leer<T>(nombre: string): Promise<T> {
  if (!cache.has(nombre)) {
    const promesa = readFile(path.join(DIR, nombre), "utf-8").then((t) => JSON.parse(t));
    // Si falla (fichero ausente), no se queda cacheado el error.
    promesa.catch(() => cache.delete(nombre));
    cache.set(nombre, promesa);
  }
  return cache.get(nombre) as Promise<T>;
}

export const datosRadar = () => leer<DatosRadar>("radar.json");
export const datosPrevio = () => leer<DatosPrevio>("previo.json");
export const datosMercado = () => leer<DatosMercado>("mercado.json");
