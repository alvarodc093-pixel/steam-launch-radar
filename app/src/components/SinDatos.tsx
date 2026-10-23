/** Mensaje claro si la app arranca sin los JSON exportados. */
export default function SinDatos({ titulo }: { titulo: string }) {
  return (
    <>
      <h1>{titulo}</h1>
      <p className="error" role="alert">
        No se encuentran los datos del modelo en <code>app/data/</code>. Desde la raíz del
        repositorio ejecuta <code>python -m radar.exportar</code> y recarga la página.
      </p>
    </>
  );
}
