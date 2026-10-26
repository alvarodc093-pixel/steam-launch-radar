"use client";

import { useEffect, useState } from "react";

import { fecha } from "@/lib/formato";
import type { LecturaRadar, Veredicto } from "@/lib/radar";
import { appidDe, type FichaSteam } from "@/lib/steam";
import type { Senales } from "@/lib/tipos";

/** Lo que devuelve /api/en-directo/{appid}. */
export interface RespuestaEnDirecto {
  ficha: FichaSteam;
  completos: number;
  acumuladas: number[];
  resenas30d: number | null;
  aviso?: string;
  entrada?: {
    dia: number;
    resenas: number;
    pct_positivas: number | null;
    precio_usd: number;
    genero: string;
    senales?: Senales;
  };
  lectura?: LecturaRadar;
}

interface Seguido {
  appid: number;
  nombre: string;
  dia: number;
  veredicto: Veredicto;
  leido: string; // fecha ISO de la última lectura
  cambio?: { de: Veredicto; dia: number };
}

const CLAVE = "radar-seguidos";
const NOMBRE: Record<Veredicto, string> = {
  por_encima: "por encima",
  en_linea: "en línea",
  por_debajo: "por debajo",
};

// El navegador puede no dejar guardar (modo privado, almacenamiento lleno):
// entonces el seguimiento dura lo que la página abierta.
function leerSeguidos(): Seguido[] {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) ?? "[]");
  } catch {
    return [];
  }
}
function guardarSeguidos(lista: Seguido[]) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista));
  } catch {}
}

export async function leerEnDirecto(appid: number): Promise<RespuestaEnDirecto> {
  const r = await fetch(`/api/en-directo/${appid}`);
  const cuerpo = await r.json();
  if (!r.ok) throw new Error(cuerpo.error ?? `Error ${r.status}`);
  return cuerpo;
}

/**
 * Campo para leer cualquier juego de Steam por su appid o su enlace, y lista
 * de los juegos que se siguen: al abrir la página se vuelven a leer y se
 * marca el que haya cambiado de veredicto desde la última visita.
 */
export default function EnDirecto({
  onLectura,
  actual,
}: {
  onLectura: (r: RespuestaEnDirecto) => void;
  /** Juego leído ahora mismo, para ofrecer seguirlo. */
  actual: RespuestaEnDirecto | null;
}) {
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seguidos, setSeguidos] = useState<Seguido[]>([]);

  async function leer(appid: number) {
    setCargando(true);
    setError(null);
    try {
      const r = await leerEnDirecto(appid);
      onLectura(r);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido leer el juego.");
      return null;
    } finally {
      setCargando(false);
    }
  }

  function enviar() {
    const appid = appidDe(texto);
    if (!appid) {
      setError("Escribe el número del juego (appid) o pega el enlace de su página en Steam.");
      return;
    }
    void leer(appid);
  }

  // Al abrir la página, vuelve a leer los juegos seguidos uno a uno.
  useEffect(() => {
    let vigente = true;
    (async () => {
      // Primero lo guardado, para que la lista se vea mientras se relee.
      const lista = leerSeguidos();
      setSeguidos(lista);
      const nueva: Seguido[] = [];
      for (const s of lista) {
        try {
          const r = await leerEnDirecto(s.appid);
          if (r.lectura && r.entrada) {
            const cambio =
              r.lectura.veredicto !== s.veredicto ? { de: s.veredicto, dia: s.dia } : s.cambio;
            nueva.push({
              ...s,
              dia: r.entrada.dia,
              veredicto: r.lectura.veredicto,
              leido: new Date().toISOString(),
              cambio,
            });
            continue;
          }
        } catch {}
        nueva.push(s); // sin lectura nueva se conserva la anterior
      }
      if (vigente) {
        setSeguidos(nueva);
        guardarSeguidos(nueva);
      }
    })();
    return () => {
      vigente = false;
    };
  }, []);

  function seguir() {
    if (!actual?.lectura || !actual.entrada) return;
    const nuevo: Seguido = {
      appid: actual.ficha.appid,
      nombre: actual.ficha.nombre,
      dia: actual.entrada.dia,
      veredicto: actual.lectura.veredicto,
      leido: new Date().toISOString(),
    };
    const lista = [...seguidos.filter((s) => s.appid !== nuevo.appid), nuevo];
    setSeguidos(lista);
    guardarSeguidos(lista);
  }

  function dejar(appid: number) {
    const lista = seguidos.filter((s) => s.appid !== appid);
    setSeguidos(lista);
    guardarSeguidos(lista);
  }

  const yaSeguido = actual && seguidos.some((s) => s.appid === actual.ficha.appid);

  return (
    <div className="campo en-directo">
      <label htmlFor="en-directo">Leer un juego de Steam en directo</label>
      <div className="fila-campo">
        <input
          id="en-directo"
          placeholder="appid o enlace de la tienda"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              enviar();
            }
          }}
        />
        <button type="button" onClick={enviar} disabled={cargando}>
          {cargando ? "Leyendo…" : "Leer"}
        </button>
      </div>
      <span className="nota">
        Descarga de Steam su ficha y sus reseñas de hoy y elige el día de lectura que le toca.
      </span>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {actual?.lectura && !yaSeguido && (
        <button type="button" className="secundario" onClick={seguir}>
          Seguir {actual.ficha.nombre}
        </button>
      )}
      {seguidos.length > 0 && (
        <div className="seguidos">
          <div className="etiqueta">Juegos que sigues</div>
          <ul>
            {seguidos.map((s) => (
              <li key={s.appid}>
                <button type="button" className="enlace" onClick={() => void leer(s.appid)}>
                  {s.nombre}
                </button>{" "}
                <span className={`chip ${s.veredicto}`}>{NOMBRE[s.veredicto]}</span>{" "}
                <span className="nota">
                  día {s.dia}, leído el {fecha(s.leido.slice(0, 10))}
                </span>
                {s.cambio && (
                  <span className="aviso-cambio" role="status">
                    {" "}
                    Cambió: era «{NOMBRE[s.cambio.de]}» el día {s.cambio.dia}.
                  </span>
                )}{" "}
                <button
                  type="button"
                  className="enlace"
                  aria-label={`Dejar de seguir ${s.nombre}`}
                  onClick={() => dejar(s.appid)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
