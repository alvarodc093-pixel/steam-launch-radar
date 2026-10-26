/** Forma de los JSON que genera `python -m radar.exportar`. */

export interface MetricasTest {
  mae_log: number;
  mediana_error_log: number;
  factor_error_tipico: number;
  spearman: number | null;
  dentro_de_x2: number;
  cobertura_90?: number;
}

export interface Arbol {
  izq: number[];
  der: number[];
  variable: number[];
  umbral: number[];
  valor: number[];
}

export interface ModeloJson {
  tipo: "mediana" | "ratio_tipico" | "ridge" | "gradient_boosting";
  numericas: string[];
  categoricas: string[];
  generos: string[];
  q90: number;
  metricas_test: MetricasTest;
  baselines_test: Record<string, MetricasTest>;
  cv_mae_log: Record<string, { mean: number; std: number }>;
  tamanos: { train: number; calibracion: number; test: number };
  mediana?: number;
  ratio?: { columna: string; desplazamiento: number };
  medianas?: Record<string, number>;
  medias?: Record<string, number>;
  escalas?: Record<string, number>;
  categorias?: Record<string, string[]>;
  ridge?: { coef: number[]; intercepto: number };
  gb?: { inicial: number; tasa: number; arboles: Arbol[] };
}

export interface Cuantiles {
  n: number;
  cuantiles: number[];
}

export interface Ejemplo {
  appid: number;
  nombre: string;
  fecha_lanzamiento: string;
  precio_usd: number;
  genero: string;
  lecturas: Record<string, { resenas: number; pct_positivas: number | null }>;
  resenas_30d: number;
  acumuladas: number[];
}

/** Lo que necesita el desplegable: el resto se pide al elegir el juego. */
export type EjemploResumen = Pick<Ejemplo, "appid" | "nombre" | "fecha_lanzamiento">;

export interface DatosRadar {
  generado_en: string;
  dias_lectura: number[];
  modelos: Record<string, ModeloJson>;
  cohortes: {
    cuantiles: number[];
    n_global: number;
    global: Record<string, number[]>;
    por_genero: Record<string, { n: number } & Record<string, number[] | number>>;
  };
  curva_tipica: Record<string, number[]>;
  ejemplos: Ejemplo[];
  /** Por día de lectura y veredicto: dónde acabaron de verdad los juegos del test. */
  aciertos_veredicto: Record<string, Record<string, AciertosVeredicto>>;
}

export interface AciertosVeredicto {
  por_encima: number;
  en_linea: number;
  por_debajo: number;
  /** «Por encima» que ya superaban el tercer cuartil el día de la lectura. */
  ya_superaba: number;
}

export interface DatosPrevio {
  generado_en: string;
  modelo: ModeloJson;
  cuantiles: number[];
  global: Cuantiles;
  por_genero: (Cuantiles & { genero: string })[];
  por_banda: (Cuantiles & { banda: string })[];
  genero_banda: (Cuantiles & { genero: string; banda: string })[];
}

export interface DatosMercado {
  generado_en: string;
  juegos_descargados: number;
  juegos_aptos: number;
  exclusiones: Record<string, number>;
  rango_lanzamientos: { desde: string; hasta: string };
  mediana_resenas_30d: number;
  mediana_pct_positivas_7d: number;
  fraccion_mediana_del_mes: Record<string, number>;
  por_mes: { mes: string; lanzamientos: number; mediana_30d: number }[];
  por_genero: { genero: string; n: number; mediana_30d: number }[];
  por_banda: { banda: string; n: number; mediana_30d: number }[];
  curva_tipica: number[];
  /** Cifras del EDA que enseña la portada (radar/eda.py). */
  hallazgos: {
    spearman_7_30: number;
    positivas_bajas: { juegos: number; residuo_mediano_log: number; efecto: number };
    epsilon2: { precio: number; genero: number };
  };
}

/** Entrada del radar tal como llega del formulario o de la API. */
export interface EntradaRadar {
  dia: number;
  resenas: number;
  pct_positivas: number | null;
  precio_usd: number;
  genero: string;
}

export interface EntradaPrevia {
  precio_usd: number;
  genero: string;
  mes_lanzamiento: number;
}

/** Ventas oficiales de juegos de la muestra frente a sus reseñas (`python -m radar.ventas`). */
export interface VentaAnunciada {
  appid: number;
  nombre: string;
  dia: number;
  fecha_aproximada: boolean;
  unidades: number;
  plataformas: string;
  resenas_ingles: number;
  copias_por_resena: number;
  copias_pc_por_resena: number | null;
  fuente: string;
  url: string;
}

interface TramoVentas {
  juegos: number;
  mediana: number;
  minimo: number;
  maximo: number;
}

export interface DatosVentas {
  resumen: {
    cifras: number;
    juegos: number;
    con_cifra_de_pc: number;
    lanzamiento: TramoVentas;
    despues_del_primer_mes: TramoVentas;
  };
  juegos: VentaAnunciada[];
}
