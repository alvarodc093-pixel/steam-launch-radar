"use client";

import { useEffect, useRef } from "react";

import { Chart, registerables, type ChartConfiguration } from "chart.js";

Chart.register(...registerables);

export interface Serie {
  etiqueta: string;
  datos: (number | null)[];
  color: string;
  /** Índice de otra serie con la que rellenar (para dibujar una banda). */
  rellenarHasta?: number;
  discontinua?: boolean;
  soloPuntos?: boolean;
  /** false para series auxiliares, como el borde inferior de una banda. */
  enLeyenda?: boolean;
}

interface Props {
  tipo: "line" | "bar";
  etiquetas: string[];
  series: Serie[];
  ejeX?: string;
  ejeY?: string;
  logaritmico?: boolean;
  /** Texto que describe el gráfico: es lo que leen los lectores de pantalla. */
  resumen: string;
}

function variable(nombre: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

export default function Grafico({ tipo, etiquetas, series, ejeX, ejeY, logaritmico, resumen }: Props) {
  const lienzo = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!lienzo.current) return;
    const texto = variable("--suave");
    const rejilla = variable("--borde");
    const config: ChartConfiguration = {
      type: tipo,
      data: {
        labels: etiquetas,
        datasets: series.map((s) => ({
          label: s.etiqueta,
          data: s.datos,
          borderColor: s.color,
          backgroundColor: s.rellenarHasta !== undefined ? s.color + "2e" : s.color,
          fill: s.rellenarHasta !== undefined ? s.rellenarHasta : false,
          borderDash: s.discontinua ? [6, 4] : undefined,
          showLine: !s.soloPuntos,
          pointRadius: s.soloPuntos ? 3 : 0,
          borderWidth: s.rellenarHasta !== undefined ? 0 : 2,
          tension: 0.2,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              color: texto,
              filter: (item) => series[item.datasetIndex ?? 0]?.enLeyenda !== false,
            },
          },
        },
        scales: {
          x: {
            title: ejeX ? { display: true, text: ejeX, color: texto } : undefined,
            ticks: { color: texto, maxTicksLimit: 12 },
            grid: { color: rejilla },
          },
          y: {
            type: logaritmico ? "logarithmic" : "linear",
            title: ejeY ? { display: true, text: ejeY, color: texto } : undefined,
            ticks: { color: texto },
            grid: { color: rejilla },
            beginAtZero: !logaritmico,
          },
        },
      },
    };
    const grafico = new Chart(lienzo.current, config);
    return () => grafico.destroy();
  }, [tipo, etiquetas, series, ejeX, ejeY, logaritmico]);

  return (
    <figure className="grafico">
      <div className="lienzo">
        <canvas ref={lienzo} aria-hidden="true" />
      </div>
      <figcaption>{resumen}</figcaption>
    </figure>
  );
}
