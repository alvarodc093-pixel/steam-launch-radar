import FormularioRadar from "@/components/FormularioRadar";
import SinDatos from "@/components/SinDatos";
import { datosRadar } from "@/lib/datos";

export const dynamic = "force-dynamic";

export default async function PaginaRadar() {
  let datos;
  try {
    datos = await datosRadar();
  } catch {
    return <SinDatos titulo="Radar de lanzamiento" />;
  }
  const generos = datos.modelos[String(datos.dias_lectura[0])].generos;

  return (
    <>
      <h1>¿Cómo va tu lanzamiento?</h1>
      <p className="entradilla">
        Con las reseñas que lleva tu juego a los {datos.dias_lectura.join(", ")} días de salir,
        el radar estima cuántas tendrá al cumplir el primer mes y te dice si eso está por
        encima, en línea o por debajo de lo habitual en juegos de su género. Sirve para
        decidir pronto si hace falta un empujón (marketing, una oferta, un parche) en lugar de
        esperar al cierre del mes.
      </p>
      <FormularioRadar dias={datos.dias_lectura} generos={generos} ejemplos={datos.ejemplos} />
    </>
  );
}
