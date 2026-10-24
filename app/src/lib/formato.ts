/** Formato en español, independiente del idioma del navegador. */

const nf = (cifras: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: cifras, maximumFractionDigits: cifras });

export const entero = (v: number) => nf(0).format(Math.round(v));
export const decimal = (v: number, cifras = 1) => nf(cifras).format(v);
export const porcentaje = (v: number, cifras = 0) =>
  new Intl.NumberFormat("es-ES", {
    style: "percent",
    minimumFractionDigits: cifras,
    maximumFractionDigits: cifras,
  }).format(v);
export const dolares = (v: number) => (v === 0 ? "gratis" : `${nf(2).format(v)} $`);

/** Los mismos tramos que `banda_precio` en radar/preparacion.py. */
export function bandaPrecio(precio: number): string {
  if (precio === 0) return "gratis";
  if (precio <= 10) return "hasta_10";
  if (precio <= 20) return "hasta_20";
  if (precio <= 40) return "hasta_40";
  return "mas_de_40";
}

export const NOMBRE_BANDA: Record<string, string> = {
  gratis: "Gratis",
  hasta_10: "Hasta 10 $",
  hasta_20: "10–20 $",
  hasta_40: "20–40 $",
  mas_de_40: "Más de 40 $",
};

export const NOMBRE_MES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function fecha(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
