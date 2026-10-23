"use client";

export default function ErrorPagina({ reset }: { reset: () => void }) {
  return (
    <>
      <h1>Algo ha fallado al cargar la página</h1>
      <p className="error" role="alert">
        No es culpa de tus datos. Prueba a recargar; si se repite, los ficheros del modelo
        pueden estar dañados.
      </p>
      <button onClick={reset}>Reintentar</button>
    </>
  );
}
