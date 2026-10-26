import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { percentil, predecirLog, variablesPrevias, variablesRadar } from "../src/lib/modelo.ts";
import { leerPrevio, leerRadar, veredicto } from "../src/lib/radar.ts";
import type { DatosPrevio, DatosRadar } from "../src/lib/tipos.ts";
import { validarPrevio, validarRadar } from "../src/lib/validacion.ts";

const leer = async <T>(ruta: string): Promise<T> => JSON.parse(await readFile(ruta, "utf-8"));

interface Caso {
  modelo: string;
  entrada: {
    precio_usd: number;
    genero: string;
    mes_lanzamiento: number;
    dia?: number;
    resenas?: number;
    pct_positivas?: number | null;
    senales?: Record<string, number | null>;
  };
  esperado: number;
}

test("TypeScript reproduce las predicciones de Python (casos dorados)", async () => {
  const radar = await leer<DatosRadar>("data/radar.json");
  const previo = await leer<DatosPrevio>("data/previo.json");
  const casos = await leer<Caso[]>("tests/casos_dorados.json");
  assert.ok(casos.length > 50, `pocos casos dorados: ${casos.length}`);

  let peor = 0;
  for (const c of casos) {
    let obtenido: number;
    if (c.modelo === "previo") {
      obtenido = predecirLog(previo.modelo, variablesPrevias(c.entrada, previo.modelo.generos));
    } else {
      const m = radar.modelos[String(c.entrada.dia)];
      const e = {
        dia: c.entrada.dia!,
        resenas: c.entrada.resenas!,
        pct_positivas: c.entrada.pct_positivas ?? null,
        precio_usd: c.entrada.precio_usd,
        genero: c.entrada.genero,
        senales: c.entrada.senales,
      };
      obtenido = predecirLog(m, variablesRadar(e, m.generos));
    }
    peor = Math.max(peor, Math.abs(obtenido - c.esperado));
  }
  // El JSON redondea a 6 decimales: diferencias por debajo de 1e-4 en log son ruido.
  assert.ok(peor < 1e-4, `diferencia máxima ${peor}`);
});

test("validación del radar: rechaza entradas imposibles con mensaje claro", () => {
  const dias = [3, 7, 14];
  const ok = validarRadar(
    { dia: 7, resenas: 120, pct_positivas: 0.9, precio_usd: 14.99, genero: "RPG" },
    dias,
  );
  assert.equal(ok.ok, true);

  const mal = validarRadar({ dia: 5, resenas: -1, precio_usd: 999, genero: "" }, dias);
  assert.equal(mal.ok, false);
  if (!mal.ok) {
    assert.match(mal.error, /dia/);
    assert.match(mal.error, /resenas/);
    assert.match(mal.error, /precio_usd/);
    assert.match(mal.error, /genero/);
  }
  assert.equal(validarRadar("texto", dias).ok, false);

  // Con cero reseñas no hay positividad: se ignora lo que mande el cliente.
  const cero = validarRadar(
    { dia: 3, resenas: 0, pct_positivas: 0.5, precio_usd: 0, genero: "RPG" },
    dias,
  );
  assert.ok(cero.ok && cero.valor.pct_positivas === null);
});

test("validación previa", () => {
  assert.equal(validarPrevio({ precio_usd: 9.99, mes_lanzamiento: 3, genero: "Action" }).ok, true);
  assert.equal(
    validarPrevio({ precio_usd: 9.99, mes_lanzamiento: 13, genero: "Action" }).ok,
    false,
  );
});

test("veredicto: solo se pronuncia si todo el intervalo queda fuera de la mitad central", () => {
  const cuantiles = [10, 50, 100, 200, 400];
  assert.equal(veredicto({ central: 30, inferior: 20, superior: 45 }, cuantiles), "por_debajo");
  assert.equal(veredicto({ central: 30, inferior: 20, superior: 60 }, cuantiles), "en_linea");
  assert.equal(veredicto({ central: 300, inferior: 210, superior: 500 }, cuantiles), "por_encima");
});

test("percentil interpola entre cuantiles y satura en los extremos", () => {
  const niveles = [0.1, 0.25, 0.5, 0.75, 0.9];
  const q = [10, 20, 40, 80, 160];
  assert.equal(percentil(5, niveles, q), 0.1);
  assert.equal(percentil(30, niveles, q), 0.375);
  assert.equal(percentil(1000, niveles, q), 0.9);
});

test("leerRadar con datos reales: rango coherente y trayectoria que acaba en la estimación", async () => {
  const datos = await leer<DatosRadar>("data/radar.json");
  const genero = Object.keys(datos.cohortes.por_genero)[0];
  const lectura = leerRadar(datos, {
    dia: 7,
    resenas: 120,
    pct_positivas: 0.9,
    precio_usd: 14.99,
    genero,
  });
  const { inferior, central, superior } = lectura.estimacion;
  assert.ok(inferior <= central && central <= superior);
  assert.ok(central >= 120, "al mes no puede haber menos reseñas que el día 7");
  assert.equal(lectura.cohorte.nombre, genero);
  assert.equal(lectura.trayectoria.length, 30);
  assert.ok(Math.abs(lectura.trayectoria[29] - central) < 1e-6);

  const otro = leerRadar(datos, {
    dia: 3,
    resenas: 0,
    pct_positivas: null,
    precio_usd: 0,
    genero: "Inventado",
  });
  assert.equal(otro.cohorte.nombre, "toda la muestra");
  assert.ok(otro.estimacion.central >= 0);
});

test("leerPrevio: referencia por género y banda, o solo por género si hay pocos juegos", async () => {
  const datos = await leer<DatosPrevio>("data/previo.json");
  const grande = [...datos.genero_banda].sort((a, b) => b.n - a.n)[0];
  const precio = { gratis: 0, hasta_10: 9.99, hasta_20: 19.99, hasta_40: 39.99, mas_de_40: 59.99 }[
    grande.banda as "gratis"
  ];
  const conBanda = leerPrevio(
    datos,
    { precio_usd: precio, genero: grande.genero, mes_lanzamiento: 3 },
    grande.banda,
  );
  assert.equal(conBanda.benchmark?.banda, grande.banda);
  assert.equal(conBanda.benchmark?.n, grande.n);

  const sinDatos = leerPrevio(
    datos,
    { precio_usd: 5, genero: "Inventado", mes_lanzamiento: 3 },
    "hasta_10",
  );
  assert.equal(sinDatos.benchmark, null);
});
