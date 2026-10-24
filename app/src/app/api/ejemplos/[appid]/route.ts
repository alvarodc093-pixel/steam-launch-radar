/** GET /api/ejemplos/[appid] — reseñas diarias de un lanzamiento del conjunto de test. */

import { NextResponse } from "next/server";

import { datosRadar } from "@/lib/datos";

export async function GET(_request: Request, { params }: { params: Promise<{ appid: string }> }) {
  const { appid } = await params;
  if (!/^\d+$/.test(appid)) {
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
  const ejemplo = radar.ejemplos.find((e) => e.appid === Number(appid));
  if (!ejemplo) {
    return NextResponse.json({ error: "Ese juego no está entre los ejemplos." }, { status: 404 });
  }
  return NextResponse.json(ejemplo, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
