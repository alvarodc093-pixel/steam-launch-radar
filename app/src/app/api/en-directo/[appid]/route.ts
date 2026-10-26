/** GET /api/en-directo/{appid} — lee un lanzamiento con sus datos de Steam de hoy.

Pide a Steam la ficha y las reseñas del juego, elige el día de lectura que le
toca (3, 7 o 14) y devuelve la entrada del radar ya calculada junto con su
lectura. Si el juego ya cumplió el mes, añade cuántas reseñas tuvo de verdad.
*/

import { NextResponse } from "next/server";

import { Limitador } from "@/lib/asistente";
import { datosRadar } from "@/lib/datos";
import { leerRadar } from "@/lib/radar";
import {
  descargarFicha,
  descargarResenas,
  diaDeLectura,
  lecturaHasta,
  MAX_PCT_PREVIAS,
  pctPrevias,
  type DiaResenas,
  type FichaSteam,
} from "@/lib/steam";

export const dynamic = "force-dynamic";

// Cada lectura son varias peticiones a Steam: un límite por IP y una caché
// por juego evitan cargar su API por recargar la página.
const limitador = new Limitador(30, 10 * 60_000);
const CACHE_MS = 30 * 60_000;
const cache = new Map<
  number,
  { hora: number; ficha: FichaSteam; dias: DiaResenas[]; completo: boolean }
>();

export async function GET(request: Request, { params }: { params: Promise<{ appid: string }> }) {
  const { appid: texto } = await params;
  const appid = Number(texto);
  if (!/^\d{1,9}$/.test(texto) || appid <= 0) {
    return NextResponse.json({ error: "El appid tiene que ser un número." }, { status: 400 });
  }

  let radar;
  try {
    radar = await datosRadar();
  } catch {
    return NextResponse.json(
      { error: "Faltan los datos del modelo. Ejecuta `python -m radar.exportar`." },
      { status: 503 },
    );
  }

  let guardado = cache.get(appid);
  if (!guardado || Date.now() - guardado.hora > CACHE_MS) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    if (!limitador.permitir(ip)) {
      return NextResponse.json(
        { error: "Has leído muchos juegos seguidos. Espera unos minutos y vuelve a probar." },
        { status: 429 },
      );
    }
    try {
      const ficha = await descargarFicha(appid);
      if (!ficha) {
        return NextResponse.json(
          { error: "Steam no tiene un juego ya lanzado con ese appid." },
          { status: 404 },
        );
      }
      const descarga = await descargarResenas(
        appid,
        ficha.fechaLanzamiento,
        process.env.STEAM_API_KEY ?? "",
      );
      guardado = { hora: Date.now(), ficha, dias: descarga.dias, completo: descarga.completo };
      cache.set(appid, guardado);
    } catch {
      return NextResponse.json(
        { error: "Steam no ha respondido. Prueba de nuevo en unos minutos." },
        { status: 502 },
      );
    }
  }

  const { ficha, dias, completo } = guardado;
  const { completos, dia } = diaDeLectura(ficha.fechaLanzamiento, new Date(), radar.dias_lectura);
  const acumuladas: number[] = [];
  for (let d = 0, suma = 0; d < Math.min(completos, 30); d++) {
    suma += dias.filter((x) => x.dia === d).reduce((s, x) => s + x.positivas + x.negativas, 0);
    acumuladas.push(suma);
  }
  const resenas30d = completos >= 30 ? acumuladas[29] : null;
  const base = { ficha, completos, acumuladas, resenas30d };

  if (dia === null) {
    return NextResponse.json({
      ...base,
      aviso: `Salió hace ${Math.max(completos, 0)} días: el radar hace su primera lectura el día ${radar.dias_lectura[0]}.`,
    });
  }
  if (!completo) {
    return NextResponse.json({
      ...base,
      aviso:
        "Tiene más reseñas de las que el radar está pensado para leer: es un lanzamiento mucho mayor que los de la muestra.",
    });
  }
  if (pctPrevias(dias) > MAX_PCT_PREVIAS) {
    return NextResponse.json({
      ...base,
      aviso:
        "Tuvo reseñas antes de su fecha oficial (salió de acceso anticipado): no parte de cero y el radar no se aplica a estos juegos.",
    });
  }
  if (ficha.precioUsd === null) {
    return NextResponse.json({
      ...base,
      aviso: "Steam no da su precio en dólares, y el radar lo necesita para comparar.",
    });
  }

  const generos = radar.modelos[String(dia)].generos;
  const { resenas, pctPositivas } = lecturaHasta(dias, dia);
  const entrada = {
    dia,
    resenas,
    pct_positivas: pctPositivas,
    precio_usd: ficha.precioUsd,
    genero: generos.includes(ficha.generoPrincipal) ? ficha.generoPrincipal : "Otro",
  };
  return NextResponse.json({ ...base, entrada, lectura: leerRadar(radar, entrada) });
}
