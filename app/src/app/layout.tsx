import type { Metadata } from "next";
import Link from "next/link";

import Secciones from "@/components/Secciones";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Steam Launch Radar", template: "%s · Steam Launch Radar" },
  description:
    "Con las reseñas de los primeros días, estima cómo cerrará el primer mes de un juego en Steam y lo compara con lanzamientos parecidos.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <a className="saltar" href="#contenido">
          Saltar al contenido
        </a>
        <header className="cabecera">
          <div className="contenedor">
            <Link href="/" className="marca">
              Steam Launch <span>Radar</span>
            </Link>
            <Secciones />
          </div>
        </header>
        <main id="contenido" className="contenedor">
          {children}
        </main>
        <footer className="pie">
          <div className="contenedor">
            Datos públicos de la tienda de Steam (buscador, ficha y reseñas en inglés). Las reseñas son
            una aproximación a la actividad de un juego, no a sus ventas.
          </div>
        </footer>
      </body>
    </html>
  );
}
