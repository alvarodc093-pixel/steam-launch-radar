/** POST /api/previo — referencia de juegos parecidos antes de lanzar. */

import { NextResponse } from "next/server";

import { datosPrevio } from "@/lib/datos";
import { bandaPrecio } from "@/lib/formato";
import { leerPrevio } from "@/lib/radar";
import { validarPrevio } from "@/lib/validacion";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo tiene que ser JSON válido." }, { status: 400 });
  }
  const entrada = validarPrevio(cuerpo);
  if (!entrada.ok) return NextResponse.json({ error: entrada.error }, { status: 400 });

  let previo;
  try {
    previo = await datosPrevio();
  } catch {
    return NextResponse.json(
      { error: "Faltan los datos del modelo. Ejecuta `python -m radar.exportar`." },
      { status: 503 },
    );
  }
  const banda = bandaPrecio(entrada.valor.precio_usd);
  return NextResponse.json({
    entrada: entrada.valor,
    banda,
    lectura: leerPrevio(previo, entrada.valor, banda),
  });
}
