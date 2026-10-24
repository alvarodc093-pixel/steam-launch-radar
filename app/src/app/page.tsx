import FormularioRadar from "@/components/FormularioRadar";
import SinDatos from "@/components/SinDatos";
import { datosRadar } from "@/lib/datos";

export const dynamic = "force-dynamic";

export default async function PaginaRadar({
  searchParams,
}: {
  searchParams: Promise<{ juego?: string; dia?: string }>;
}) {
  const { juego, dia } = await searchParams;
  let radar;
  try {
    radar = await datosRadar();
  } catch {
    return <SinDatos titulo="Radar de lanzamiento" />;
  }
  const generos = radar.modelos[String(radar.dias_lectura[0])].generos;
  const ejemplos = radar.ejemplos
    .map(({ appid, nombre, fecha_lanzamiento }) => ({ appid, nombre, fecha_lanzamiento }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const ejemploInicial = juego ? radar.ejemplos.find((e) => e.appid === Number(juego)) : undefined;

  return (
    <>
      <h1>¿Cómo va tu lanzamiento?</h1>
      <p className="entradilla">
        Con las reseñas en inglés que lleva tu juego a los {radar.dias_lectura.join(", ")} días de
        salir, el radar estima cuántas tendrá al cumplir el primer mes y te dice si eso está por
        encima, en línea o por debajo de lo habitual en juegos de su género. Sirve para decidir
        pronto si hace falta un empujón (marketing, una oferta, un parche) en lugar de esperar al
        cierre del mes.
      </p>
      <FormularioRadar
        dias={radar.dias_lectura}
        generos={generos}
        ejemplos={ejemplos}
        inicial={ejemploInicial ? { ejemplo: ejemploInicial, dia: Number(dia ?? 7) } : undefined}
      />
    </>
  );
}
