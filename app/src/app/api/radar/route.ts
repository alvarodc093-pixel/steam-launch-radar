/** POST /api/radar — lectura del radar para un juego en sus primeros días. */

import { NextResponse } from "next/server";

import { datosRadar } from "@/lib/datos";
import { leerRadar } from "@/lib/radar";
import { validarRadar } from "@/lib/validacion";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo tiene que ser JSON válido." }, { status: 400 });
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

  const entrada = validarRadar(cuerpo, radar.dias_lectura);
  if (!entrada.ok) return NextResponse.json({ error: entrada.error }, { status: 400 });
  return NextResponse.json({ entrada: entrada.valor, lectura: leerRadar(radar, entrada.valor) });
}
