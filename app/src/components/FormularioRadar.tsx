"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Grafico, { type Serie } from "@/components/Grafico";
import { dolares, entero, fecha, porcentaje } from "@/lib/formato";
import type { LecturaRadar, Veredicto } from "@/lib/radar";
import type { Ejemplo } from "@/lib/tipos";

interface Props {
  dias: number[];
  generos: string[];
  ejemplos: Ejemplo[];
  /** Lectura que abrir al cargar (enlace compartible ?juego=…&dia=…). */
  inicial?: { appid: number; dia: number };
}

const TITULO: Record<Veredicto, string> = {
  por_encima: "Por encima de lo habitual",
  en_linea: "Dentro de lo habitual",
  por_debajo: "Por debajo de lo habitual",
};

const EXPLICACION: Record<Veredicto, string> = {
  por_encima:
    "Incluso en el escenario prudente, el juego cerraría el mes por encima de tres de cada cuatro lanzamientos parecidos.",
  en_linea:
    "El rango de la estimación se solapa con la mitad central de los lanzamientos parecidos: todavía no hay señal clara en ningún sentido.",
  por_debajo:
    "Incluso en el escenario optimista, el juego cerraría el mes por debajo de tres de cada cuatro lanzamientos parecidos.",
};

const VACIO = { resenas: "", pct: "", precio: "", genero: "" };
type Campos = typeof VACIO;

function camposDe(e: Ejemplo, d: number, generos: string[]): Campos {
  const l = e.lecturas[String(d)];
  return {
    resenas: String(l.resenas),
    pct: l.pct_positivas === null ? "" : String(Math.round(l.pct_positivas * 100)),
    precio: String(e.precio_usd),
    genero: generos.includes(e.genero) ? e.genero : "Otro",
  };
}

export default function FormularioRadar({ dias, generos, ejemplos, inicial }: Props) {
  const ejemploInicial = inicial ? (ejemplos.find((e) => e.appid === inicial.appid) ?? null) : null;
  const diaInicial = inicial && dias.includes(inicial.dia) ? inicial.dia : (dias[1] ?? dias[0]);
  const [dia, setDia] = useState(diaInicial);
  const [campos, setCampos] = useState<Campos>(
    ejemploInicial ? camposDe(ejemploInicial, diaInicial, generos) : VACIO,
  );
  const [ejemplo, setEjemplo] = useState<Ejemplo | null>(ejemploInicial);
  const [lectura, setLectura] = useState<LecturaRadar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const consultado = useRef(false);

  function rellenar(e: Ejemplo | null, d: number) {
    if (e) setCampos(camposDe(e, d, generos));
  }

  function elegirEjemplo(appid: string) {
    const e = ejemplos.find((x) => String(x.appid) === appid) ?? null;
    setEjemplo(e);
    setLectura(null);
    if (e) rellenar(e, dia);
    else setCampos(VACIO);
  }

  function elegirDia(d: number) {
    setDia(d);
    setLectura(null);
    rellenar(ejemplo, d);
  }

  function cambiar(campo: keyof typeof VACIO, valor: string) {
    setCampos((c) => ({ ...c, [campo]: valor }));
    setEjemplo(null);
    setLectura(null);
  }

  async function consultar(c: Campos, d: number) {
    setError(null);
    if (c.resenas === "" || c.precio === "" || !c.genero) {
      setError("Rellena las reseñas, el precio y el género.");
      return;
    }
    setCargando(true);
    try {
      const r = await fetch("/api/radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dia: d,
          resenas: Number(c.resenas),
          pct_positivas: c.pct === "" ? null : Number(c.pct) / 100,
          precio_usd: Number(c.precio),
          genero: c.genero,
        }),
      });
      const datos = await r.json();
      if (!r.ok) setError(datos.error ?? `Error ${r.status}`);
      else setLectura(datos.lectura);
    } catch {
      setError("No se ha podido contactar con el servidor. Prueba de nuevo en unos segundos.");
    } finally {
      setCargando(false);
    }
  }

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    void consultar(campos, dia);
  }

  // Con un enlace ?juego=…&dia=… la lectura se hace sola al abrir la página.
  useEffect(() => {
    if (ejemploInicial && !consultado.current) {
      consultado.current = true;
      void consultar(camposDe(ejemploInicial, diaInicial, generos), diaInicial);
    }
    // Solo al montar: después manda el formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dos-columnas">
      <form className="panel" onSubmit={enviar} noValidate>
        <div className="campo">
          <label htmlFor="ejemplo">Probar con un lanzamiento real</label>
          <select id="ejemplo" value={ejemplo?.appid ?? ""} onChange={(e) => elegirEjemplo(e.target.value)}>
            <option value="">— Mis propios datos —</option>
            {ejemplos.map((e) => (
              <option key={e.appid} value={e.appid}>
                {e.nombre} ({fecha(e.fecha_lanzamiento)})
              </option>
            ))}
          </select>
          <span className="nota">
            Juegos que el modelo no vio al entrenar: puedes comparar su estimación con lo que
            pasó de verdad.
          </span>
        </div>

        <fieldset className="campo" style={{ border: 0, padding: 0, margin: "0 0 0.9rem" }}>
          <legend style={{ fontWeight: 600, fontSize: "0.92rem", marginBottom: "0.25rem" }}>
            Días desde el lanzamiento
          </legend>
          <div className="segmentos">
            {dias.map((d) => (
              <label key={d}>
                <input type="radio" name="dia" checked={d === dia} onChange={() => elegirDia(d)} />
                <span>{d} días</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="campo">
          <label htmlFor="resenas">Reseñas en inglés acumuladas hasta hoy</label>
          <input id="resenas" inputMode="numeric" value={campos.resenas} onChange={(e) => cambiar("resenas", e.target.value)} />
          <span className="nota">En la página del juego en Steam, filtra las reseñas por idioma: inglés.</span>
        </div>
        <div className="campo">
          <label htmlFor="pct">Porcentaje de reseñas positivas</label>
          <input id="pct" inputMode="decimal" placeholder="Vacío si aún no lo sabes" value={campos.pct} onChange={(e) => cambiar("pct", e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="precio">Precio en dólares (0 si es gratis)</label>
          <input id="precio" inputMode="decimal" value={campos.precio} onChange={(e) => cambiar("precio", e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="genero">Género principal</label>
          <select id="genero" value={campos.genero} onChange={(e) => cambiar("genero", e.target.value)}>
            <option value="">— Elige —</option>
            {generos.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
            <option value="Otro">Otro</option>
          </select>
        </div>
        <button type="submit" disabled={cargando}>
          {cargando ? "Calculando…" : "Leer el radar"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>

      <section aria-live="polite">
        {lectura ? (
          <Resultado lectura={lectura} dia={dia} resenas={Number(campos.resenas)} ejemplo={ejemplo} />
        ) : (
          <div className="panel nota">
            Elige un lanzamiento real o introduce los datos de tu juego. El radar estima las
            reseñas que tendrá al cumplir 30 días y te dice si eso es mucho o poco comparado
            con juegos del mismo género.
          </div>
        )}
      </section>
    </div>
  );
}

function Resultado({
  lectura,
  dia,
  resenas,
  ejemplo,
}: {
  lectura: LecturaRadar;
  dia: number;
  resenas: number;
  ejemplo: Ejemplo | null;
}) {
  const { estimacion: est, cohorte } = lectura;
  const [, q25, q50, q75] = cohorte.cuantiles30d;

  const series = useMemo<Serie[]>(() => {
    const escala = (v: number) => lectura.trayectoria.map((t) => (t / est.central) * v);
    // La banda se dibuja rellenando desde la serie 1 (rango alto) hasta la 0
    // (rango bajo, invisible).
    const s: Serie[] = [
      { etiqueta: "Rango bajo", datos: escala(est.inferior), color: "#1e7a5200", enLeyenda: false },
      { etiqueta: "Rango del 90 %", datos: escala(est.superior), color: "#1e7a52", rellenarHasta: 0 },
      { etiqueta: "Trayectoria esperada", datos: lectura.trayectoria, color: "#1e7a52", discontinua: true },
      {
        etiqueta: `Hoy (día ${dia})`,
        datos: lectura.trayectoria.map((_, i) => (i === dia - 1 ? resenas : null)),
        color: "#b3402a",
        soloPuntos: true,
      },
    ];
    if (ejemplo) {
      s.push({ etiqueta: "Lo que pasó", datos: ejemplo.acumuladas, color: "#2f5bd7" });
    }
    return s;
  }, [lectura, est, dia, resenas, ejemplo]);

  const etiquetas = useMemo(() => lectura.trayectoria.map((_, i) => String(i + 1)), [lectura]);
  const dentro = ejemplo && ejemplo.resenas_30d >= est.inferior && ejemplo.resenas_30d <= est.superior;

  return (
    <>
      <div className={`veredicto ${lectura.veredicto}`}>
        <strong>{TITULO[lectura.veredicto]}</strong>
        <p style={{ margin: "0.3rem 0 0" }}>{EXPLICACION[lectura.veredicto]}</p>
      </div>

      <div className="rejilla" style={{ marginTop: "1rem" }}>
        <div className="panel">
          <div className="etiqueta">Reseñas a 30 días</div>
          <div className="cifra">~{entero(est.central)}</div>
          <div className="nota">
            Rango del 90 %: {entero(est.inferior)} – {entero(est.superior)}
          </div>
        </div>
        <div className="panel">
          <div className="etiqueta">Hoy frente a su cohorte</div>
          <div className="cifra">{porcentajeCohorte(lectura.percentilLectura)}</div>
          <div className="nota">
            de los juegos de {cohorte.nombre} tenían menos reseñas el día {dia} (n = {cohorte.n})
          </div>
        </div>
        <div className="panel">
          <div className="etiqueta">Un mes típico en su cohorte</div>
          <div className="cifra">{entero(q50)}</div>
          <div className="nota">
            reseñas; la mitad central va de {entero(q25)} a {entero(q75)}
          </div>
        </div>
      </div>

      {ejemplo && (
        <p className={dentro ? "nota" : "aviso"} style={{ marginTop: "1rem" }}>
          {ejemplo.nombre} ({dolares(ejemplo.precio_usd)}) cerró su primer mes con{" "}
          <strong>{entero(ejemplo.resenas_30d)}</strong> reseñas:{" "}
          {dentro ? "dentro del rango estimado." : "fuera del rango estimado (pasa en torno a 1 de cada 10 juegos)."}
        </p>
      )}

      <div className="panel" style={{ marginTop: "1rem" }}>
        <Grafico
          tipo="line"
          etiquetas={etiquetas}
          series={series}
          ejeX="Día desde el lanzamiento"
          ejeY="Reseñas acumuladas"
          resumen={`Trayectoria típica de ${cohorte.nombre} escalada a la estimación: unas ${entero(est.central)} reseñas el día 30, con un rango de ${entero(est.inferior)} a ${entero(est.superior)}.`}
        />
      </div>

      <p className="nota">
        Error típico del modelo en juegos que no había visto: la estimación se desvía un factor
        ×{lectura.modelo.factorError.toFixed(2).replace(".", ",")} del valor real
        {lectura.modelo.cobertura !== undefined &&
          `, y el rango del 90 % acertó en el ${porcentaje(lectura.modelo.cobertura)} de los casos`}{" "}
        (test de {lectura.modelo.nTest} lanzamientos).
      </p>
    </>
  );
}

function porcentajeCohorte(p: number): string {
  if (p <= 0.1) return "< 10 %";
  if (p >= 0.9) return "> 90 %";
  return porcentaje(p);
}
