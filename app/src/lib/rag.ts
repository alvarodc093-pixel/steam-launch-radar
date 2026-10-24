/** Recuperación del asistente: BM25, similitud de embeddings y su fusión.

El índice lo genera `python -m radar.rag`. Esta parte no hace llamadas de red,
así que los tests la evalúan sin Ollama: recibe ya el vector de la consulta
(o null si no hay modelo de embeddings disponible).
*/

export interface Fragmento {
  id: string;
  tipo: "documentacion" | "juego";
  titulo: string;
  texto: string;
  appid?: number;
}

export interface IndiceRag {
  generado_en: string;
  fragmentos: Fragmento[];
  embeddings: {
    modelo: string;
    dimension: number;
    prefijo_consulta: string;
    /** int8 en base64, un vector normalizado (× 127) tras otro. */
    datos: string;
  } | null;
}

export type ModoBusqueda = "hibrida" | "lexica" | "semantica";

export interface Recuperado {
  fragmento: Fragmento;
  puntuacion: number;
}

// Palabras que aparecen en casi todos los fragmentos y no ayudan a distinguir.
const VACIAS = new Set(
  (
    "a al algo algun alguna algunos ante con contra cual cuales cuando de del desde donde " +
    "durante e el ella ellas ellos en entre era es esa ese eso esta este esto fue ha han hay " +
    "la las le les lo los mas me mi mucho muy no nos o os otra otro para pero poco por porque " +
    "que quien se sea ser si sin sobre son su sus tambien tiene tu un una unas uno unos y ya " +
    "the of and to in is for on with"
  ).split(" "),
);

/** Minúsculas, sin tildes y sin palabras vacías. Conserva números y appids. */
export function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t && !VACIAS.has(t));
}

/** BM25 clásico (k1 = 1,2; b = 0,75) sobre el texto y el título. */
export class Bm25 {
  private readonly docs: Map<string, number>[];
  private readonly longitudes: number[];
  private readonly media: number;
  private readonly df = new Map<string, number>();

  constructor(fragmentos: Fragmento[]) {
    this.docs = fragmentos.map((f) => {
      const frecuencias = new Map<string, number>();
      for (const t of tokenizar(`${f.titulo} ${f.texto}`)) {
        frecuencias.set(t, (frecuencias.get(t) ?? 0) + 1);
      }
      return frecuencias;
    });
    this.longitudes = this.docs.map((d) => [...d.values()].reduce((a, b) => a + b, 0));
    this.media = this.longitudes.reduce((a, b) => a + b, 0) / Math.max(1, this.docs.length);
    for (const d of this.docs) {
      for (const t of d.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
  }

  puntuar(consulta: string): Float64Array {
    const n = this.docs.length;
    const puntos = new Float64Array(n);
    for (const t of new Set(tokenizar(consulta))) {
      const df = this.df.get(t);
      if (!df) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < n; i++) {
        const tf = this.docs[i].get(t);
        if (!tf) continue;
        const norma = 1 - 0.75 + (0.75 * this.longitudes[i]) / this.media;
        puntos[i] += (idf * tf * 2.2) / (tf + 1.2 * norma);
      }
    }
    return puntos;
  }
}

export function decodificarVectores(datos: string): Int8Array {
  const bytes = Uint8Array.from(atob(datos), (c) => c.charCodeAt(0));
  return new Int8Array(bytes.buffer);
}

/** Coseno de la consulta (normalizada aquí) con cada fragmento. */
export function similitudes(
  vectores: Int8Array,
  dimension: number,
  consulta: number[],
): Float64Array {
  const norma = Math.hypot(...consulta) || 1;
  const n = vectores.length / dimension;
  const resultado = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let producto = 0;
    const base = i * dimension;
    for (let j = 0; j < dimension; j++) producto += vectores[base + j] * consulta[j];
    resultado[i] = producto / (127 * norma);
  }
  return resultado;
}

function ranking(puntos: Float64Array, limite: number): number[] {
  return [...puntos.keys()]
    .filter((i) => puntos[i] > 0)
    .sort((a, b) => puntos[b] - puntos[a])
    .slice(0, limite);
}

/**
 * Reciprocal Rank Fusion: suma 1 / (60 + posición) de cada ranking. No
 * necesita que las puntuaciones de BM25 y del coseno estén en la misma escala.
 */
export function fusionar(rankings: number[][], k = 60): Map<number, number> {
  const total = new Map<number, number>();
  for (const r of rankings) {
    r.forEach((i, posicion) => total.set(i, (total.get(i) ?? 0) + 1 / (k + posicion + 1)));
  }
  return total;
}

export class Buscador {
  readonly indice: IndiceRag;
  readonly bm25: Bm25;
  private readonly vectores: Int8Array | null;

  constructor(indice: IndiceRag) {
    this.indice = indice;
    this.bm25 = new Bm25(indice.fragmentos);
    this.vectores = indice.embeddings ? decodificarVectores(indice.embeddings.datos) : null;
  }

  get tieneEmbeddings(): boolean {
    return this.vectores !== null;
  }

  /**
   * Los k fragmentos más relevantes. Con vector de consulta combina ambos
   * rankings; sin él, solo BM25. `modo` permite forzar uno (para evaluar).
   */
  buscar(
    consulta: string,
    vectorConsulta: number[] | null,
    k = 6,
    modo?: ModoBusqueda,
  ): { modo: ModoBusqueda; resultados: Recuperado[] } {
    const profundidad = 50;
    const lexico = ranking(this.bm25.puntuar(consulta), profundidad);
    const semantico =
      this.vectores && vectorConsulta && this.indice.embeddings
        ? ranking(
            similitudes(this.vectores, this.indice.embeddings.dimension, vectorConsulta),
            profundidad,
          )
        : null;

    const elegido: ModoBusqueda = modo ?? (semantico ? "hibrida" : "lexica");
    const rankings =
      elegido === "lexica" || !semantico
        ? [lexico]
        : elegido === "semantica"
          ? [semantico]
          : [lexico, semantico];
    const fusion = fusionar(rankings);
    const resultados = [...fusion.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([i, puntuacion]) => ({ fragmento: this.indice.fragmentos[i], puntuacion }));
    return { modo: semantico ? elegido : "lexica", resultados };
  }
}
