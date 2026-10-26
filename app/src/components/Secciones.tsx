"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// En el orden en que se cuenta el proyecto: primero el mercado, después cómo se
// comprobó el modelo, la herramienta y, al final, el asistente.
export const SECCIONES = [
  { href: "/", texto: "Mercado" },
  { href: "/metodologia", texto: "Metodología" },
  { href: "/radar", texto: "Radar" },
  { href: "/antes-de-lanzar", texto: "Antes de lanzar" },
  { href: "/asistente", texto: "Asistente" },
];

export default function Secciones() {
  const ruta = usePathname();
  return (
    <nav className="secciones" aria-label="Secciones">
      {SECCIONES.map((s) => (
        <Link key={s.href} href={s.href} aria-current={ruta === s.href ? "page" : undefined}>
          {s.texto}
        </Link>
      ))}
    </nav>
  );
}

/** Enlace a la sección que sigue, para recorrer la web sin volver arriba. */
export function Siguiente() {
  const ruta = usePathname();
  const i = SECCIONES.findIndex((s) => s.href === ruta);
  const siguiente = i >= 0 ? SECCIONES[i + 1] : undefined;
  if (!siguiente) return null;
  return (
    <nav className="siguiente" aria-label="Siguiente sección">
      <Link href={siguiente.href}>
        <span className="nota">Siguiente</span>
        <span>{siguiente.texto} →</span>
      </Link>
    </nav>
  );
}
