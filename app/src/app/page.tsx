import FormularioRadar from "@/components/FormularioRadar";
import HallazgosEda from "@/components/HallazgosEda";
import type { DatosPortada, Destacado } from "@/components/PortadaRadar";
import SinDatos from "@/components/SinDatos";
import { datosMercado, datosRadar } from "@/lib/datos";
import { leerRadar, type Veredicto } from "@/lib/radar";
import type { DatosRadar } from "@/lib/tipos";

export const dynamic = "force-dynamic";

const DIA_DESTACADOS = 7;
const ORDEN: Veredicto[] = ["por_encima", "en_linea", "por_debajo"];

/**
 * Un juego de test por veredicto para la portada: el de más reseñas entre los
 * que cerraron el mes dentro del rango estimado, para que el ejemplo enseñe
 * cómo funciona el radar y no un caso raro.
 */
function destacados(radar: DatosRadar, dia: number, generos: string[]): Destacado[] {
  const mejores = new Map<Veredicto, { destacado: Destacado; final: number }>();
  for (const e of radar.ejemplos) {
    const l = e.lecturas[String(dia)];
    if (!l) continue;
    const lectura = leerRadar(radar, {
      dia,
      resenas: l.resenas,
      pct_positivas: l.pct_positivas,
      precio_usd: e.precio_usd,
      genero: generos.includes(e.genero) ? e.genero : "Otro",
    });
    const { inferior, superior, central } = lectura.estimacion;
    if (e.resenas_30d < inferior || e.resenas_30d > superior) continue;
    const actual = mejores.get(lectura.veredicto);
    if (!actual || e.resenas_30d > actual.final) {
      mejores.set(lectura.veredicto, {
        final: e.resenas_30d,
        destacado: {
          appid: e.appid,
          nombre: e.nombre,
          genero: e.genero,
          precio_usd: e.precio_usd,
          resenas: l.resenas,
          veredicto: lectura.veredicto,
          estimacion: central,
        },
      });
    }
  }
  return ORDEN.flatMap((v) => mejores.get(v)?.destacado ?? []);
}

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
  // Sin mercado.json el radar funciona igual: solo se pierden los hallazgos.
  const mercado = await datosMercado().catch(() => null);
  const generos = radar.modelos[String(radar.dias_lectura[0])].generos;
  const ejemplos = radar.ejemplos
    .map(({ appid, nombre, fecha_lanzamiento }) => ({ appid, nombre, fecha_lanzamiento }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const diaPortada = radar.dias_lectura.includes(DIA_DESTACADOS)
    ? DIA_DESTACADOS
    : radar.dias_lectura[0];
  const portada: DatosPortada = {
    dia: diaPortada,
    destacados: destacados(radar, diaPortada, generos),
    precision: radar.dias_lectura.map((d) => ({
      dia: d,
      factor: radar.modelos[String(d)].metricas_test.factor_error_tipico,
      cobertura: radar.modelos[String(d)].metricas_test.cobertura_90,
    })),
    // La de toda la muestra, la misma que citan Mercado y el README.
    curva: mercado?.curva_tipica ?? radar.curva_tipica.global,
    nEntrenamiento: radar.modelos[String(radar.dias_lectura[0])].tamanos.train,
  };
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
        portada={portada}
      />
      {mercado && <HallazgosEda m={mercado} />}
    </>
  );
}
