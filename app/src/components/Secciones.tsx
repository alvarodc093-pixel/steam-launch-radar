"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES = [
  { href: "/", texto: "Radar" },
  { href: "/antes-de-lanzar", texto: "Antes de lanzar" },
  { href: "/mercado", texto: "Mercado" },
  { href: "/metodologia", texto: "Metodología" },
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
