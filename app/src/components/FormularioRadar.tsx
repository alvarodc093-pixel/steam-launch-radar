"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Grafico, { type Serie } from "@/components/Grafico";
import PortadaRadar, { type DatosPortada } from "@/components/PortadaRadar";
import { dolares, entero, fecha, porcentaje } from "@/lib/formato";
import type { LecturaRadar, Veredicto } from "@/lib/radar";
import type { Ejemplo, EjemploResumen } from "@/lib/tipos";

interface Props {
  dias: number[];
  generos: string[];
  /** Solo nombre y fecha: los datos de cada juego se piden al elegirlo. */
  ejemplos: EjemploResumen[];
  /** Lectura que abrir al cargar (enlace compartible ?juego=…&dia=…). */
  inicial?: { ejemplo: Ejemplo; dia: number };
  /** Lo que se enseña en la columna del resultado antes de la primera lectura. */
  portada: DatosPortada;
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

/** Comprobación previa con los nombres que ve el usuario (la API valida otra vez). */
function errorEnCampos(c: Campos): string | null {
  if (c.resenas === "" || c.precio === "" || !c.genero) {
    return "Rellena las reseñas, el precio y el género.";
  }
  const resenas = Number(c.resenas);
  if (!Number.isInteger(resenas) || resenas < 0) {
    return "Las reseñas tienen que ser un número entero, 0 o más.";
  }
  const pct = Number(c.pct);
  if (c.pct !== "" && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
    return "El porcentaje de positivas va de 0 a 100.";
  }
  const precio = Number(c.precio.replace(",", "."));
  if (!Number.isFinite(precio) || precio < 0 || precio > 200) {
    return "El precio tiene que estar entre 0 y 200 dólares.";
  }
  return null;
}

function camposDe(e: Ejemplo, d: number, generos: string[]): Campos {
  const l = e.lecturas[String(d)];
  return {
    resenas: String(l.resenas),
    pct: l.pct_positivas === null ? "" : String(Math.round(l.pct_positivas * 100)),
    precio: String(e.precio_usd),
    genero: generos.includes(e.genero) ? e.genero : "Otro",
  };
}

export default function FormularioRadar({ dias, generos, ejemplos, inicial, portada }: Props) {
  const ejemploInicial = inicial?.ejemplo ?? null;
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

  async function cargarEjemplo(appid: string): Promise<Ejemplo | null> {
    setCargando(true);
    try {
      const r = await fetch(`/api/ejemplos/${appid}`);
      if (!r.ok) throw new Error(String(r.status));
      const e: Ejemplo = await r.json();
      setEjemplo(e);
      return e;
    } catch {
      setError("No se ha podido cargar ese juego. Prueba de nuevo en unos segundos.");
      return null;
    } finally {
      setCargando(false);
    }
  }

  async function elegirEjemplo(appid: string) {
    setLectura(null);
    setError(null);
    if (!appid) {
      setEjemplo(null);
      setCampos(VACIO);
      return;
    }
    const e = await cargarEjemplo(appid);
    if (e) rellenar(e, dia);
  }

  /** Atajo de la portada: carga el juego y lee el radar en el día de los destacados. */
  async function probar(appid: number) {
    setError(null);
    const e = await cargarEjemplo(String(appid));
    if (!e) return;
    const c = camposDe(e, portada.dia, generos);
    setDia(portada.dia);
    setCampos(c);
    await consultar(c, portada.dia);
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
    const problema = errorEnCampos(c);
    setError(problema);
    if (problema) return;
    setCargando(true);
    try {
      const r = await fetch("/api/radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dia: d,
          resenas: Number(c.resenas),
          pct_positivas: c.pct === "" ? null : Number(c.pct) / 100,
          precio_usd: Number(c.precio.replace(",", ".")),
          genero: c.genero,
        }),
      });
      const cuerpo = await r.json();
      if (!r.ok) setError(cuerpo.error ?? `Error ${r.status}`);
      else setLectura(cuerpo.lectura);
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
          <select
            id="ejemplo"
            value={ejemplo?.appid ?? ""}
            onChange={(e) => void elegirEjemplo(e.target.value)}
          >
            <option value="">— Mis propios datos —</option>
            {ejemplos.map((e) => (
              <option key={e.appid} value={e.appid}>
                {e.nombre} ({fecha(e.fecha_lanzamiento)})
              </option>
            ))}
          </select>
          <span className="nota">
            Juegos que el modelo no vio al entrenar: puedes comparar su estimación con lo que pasó
            de verdad.
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
          <input
            id="resenas"
            inputMode="numeric"
            value={campos.resenas}
            onChange={(e) => cambiar("resenas", e.target.value)}
          />
          <span className="nota">
            En la página del juego en Steam, filtra las reseñas por idioma: inglés.
          </span>
        </div>
        <div className="campo">
          <label htmlFor="pct">Porcentaje de reseñas positivas (0–100)</label>
          <input
            id="pct"
            inputMode="decimal"
            placeholder="Vacío si aún no lo sabes"
            value={campos.pct}
            onChange={(e) => cambiar("pct", e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="precio">Precio en dólares (0 si es gratis)</label>
          <input
            id="precio"
            inputMode="decimal"
            value={campos.precio}
            onChange={(e) => cambiar("precio", e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="genero">Género principal</label>
          <select
            id="genero"
            value={campos.genero}
            onChange={(e) => cambiar("genero", e.target.value)}
          >
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
          <Resultado
            lectura={lectura}
            dia={dia}
            resenas={Number(campos.resenas)}
            ejemplo={ejemplo}
          />
        ) : (
          <PortadaRadar datos={portada} onProbar={(a) => void probar(a)} cargando={cargando} />
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
      {
        etiqueta: "Rango bajo",
        valores: escala(est.inferior),
        color: "#1e7a5200",
        enLeyenda: false,
      },
      {
        etiqueta: "Rango del 90 %",
        valores: escala(est.superior),
        color: "#1e7a52",
        rellenarHasta: 0,
      },
      {
        etiqueta: "Trayectoria esperada",
        valores: lectura.trayectoria,
        color: "#1e7a52",
        discontinua: true,
      },
      {
        etiqueta: `Hoy (día ${dia})`,
        valores: lectura.trayectoria.map((_, i) => (i === dia - 1 ? resenas : null)),
        color: "#b3402a",
        soloPuntos: true,
      },
    ];
    if (ejemplo) {
      s.push({ etiqueta: "Lo que pasó", valores: ejemplo.acumuladas, color: "#2f5bd7" });
    }
    return s;
  }, [lectura, est, dia, resenas, ejemplo]);

  const etiquetas = useMemo(() => lectura.trayectoria.map((_, i) => String(i + 1)), [lectura]);
  const dentro =
    ejemplo && ejemplo.resenas_30d >= est.inferior && ejemplo.resenas_30d <= est.superior;

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
          {dentro
            ? "dentro del rango estimado."
            : "fuera del rango estimado (pasa en torno a 1 de cada 10 juegos)."}
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
        Error típico del modelo en juegos que no había visto: la estimación se desvía un factor ×
        {lectura.modelo.factorError.toFixed(2).replace(".", ",")} del valor real
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
