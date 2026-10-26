import assert from "node:assert/strict";
import test from "node:test";

import {
  agregarPorDia,
  appidDe,
  diaDeLectura,
  fechaSteam,
  generoPrincipal,
  lecturaHasta,
  parsearFicha,
  pctPrevias,
} from "../src/lib/steam.ts";

test("appid de un número o de un enlace de la tienda", () => {
  assert.equal(appidDe(" 2121510 "), 2121510);
  assert.equal(appidDe("https://store.steampowered.com/app/2121510/Tenebris_Somnia/"), 2121510);
  assert.equal(appidDe("Tenebris Somnia"), null);
  assert.equal(appidDe(""), null);
});

test("fechas de Steam en los dos órdenes y sin día exacto", () => {
  assert.equal(fechaSteam("Oct 16, 2026"), "2026-10-16");
  assert.equal(fechaSteam("16 Oct, 2026"), "2026-10-16");
  assert.equal(fechaSteam("Sept 3, 2026"), "2026-09-03");
  assert.equal(fechaSteam("Oct 2026"), null);
  assert.equal(fechaSteam("Coming soon"), null);
});

test("género principal sin los genéricos, como en la preparación de Python", () => {
  assert.equal(generoPrincipal(["Indie", "Free To Play", "RPG", "Action"]), "RPG");
  assert.equal(generoPrincipal(["Indie"]), "Indie");
  assert.equal(generoPrincipal([]), "Sin género");
});

test("ficha: precio de lista en dólares y solo juegos ya lanzados", () => {
  const respuesta = (datos: object) => ({ "10": { success: true, data: datos } });
  const juego = {
    type: "game",
    name: "Juego",
    release_date: { date: "Oct 16, 2026", coming_soon: false },
    price_overview: { currency: "USD", initial: 2499, final: 1249 },
    genres: [{ description: "Indie" }, { description: "Adventure" }],
  };
  const ficha = parsearFicha(10, respuesta(juego));
  assert.equal(ficha?.precioUsd, 24.99); // el de lista, no el rebajado
  assert.equal(ficha?.generoPrincipal, "Adventure");
  assert.equal(ficha?.fechaLanzamiento, "2026-10-16");
  assert.equal(parsearFicha(10, respuesta({ ...juego, is_free: true }))?.precioUsd, 0);
  assert.equal(
    parsearFicha(10, respuesta({ ...juego, price_overview: undefined }))?.precioUsd,
    null,
  );
  assert.equal(parsearFicha(10, respuesta({ ...juego, type: "dlc" })), null);
  assert.equal(
    parsearFicha(10, respuesta({ ...juego, release_date: { date: "Q4 2026", coming_soon: true } })),
    null,
  );
  assert.equal(parsearFicha(10, { "10": { success: false } }), null);
});

test("reseñas por día UTC relativo al lanzamiento y lectura del día 7", () => {
  const t = (fechaHora: string) => Date.parse(fechaHora) / 1000;
  const dias = agregarPorDia(
    [
      { timestamp_created: t("2026-10-15T23:00:00Z"), voted_up: true }, // día −1
      { timestamp_created: t("2026-10-16T00:30:00Z"), voted_up: true }, // día 0
      { timestamp_created: t("2026-10-16T23:59:00Z"), voted_up: false }, // día 0
      { timestamp_created: t("2026-10-22T12:00:00Z"), voted_up: true }, // día 6
      { timestamp_created: t("2026-10-23T00:00:00Z"), voted_up: true }, // día 7: fuera
      { timestamp_created: t("2026-10-20T00:00:00Z") }, // sin voto
    ],
    "2026-10-16",
  );
  assert.deepEqual(
    dias.map((d) => [d.dia, d.positivas, d.negativas]),
    [
      [-1, 1, 0],
      [0, 1, 1],
      [6, 1, 0],
      [7, 1, 0],
    ],
  );
  const lectura = lecturaHasta(dias, 7);
  assert.equal(lectura.resenas, 3);
  assert.ok(Math.abs((lectura.pctPositivas ?? 0) - 2 / 3) < 1e-9);
  assert.equal(lecturaHasta(dias, 3).resenas, 2);
  assert.equal(lecturaHasta([], 3).pctPositivas, null);
  assert.equal(pctPrevias(dias), 1 / 5);
});

test("día de lectura: el mayor ya completo", () => {
  const lectura = (iso: string) => diaDeLectura("2026-10-16", new Date(iso), [3, 7, 14]);
  assert.deepEqual(lectura("2026-10-18T12:00:00Z"), { completos: 2, dia: null });
  assert.deepEqual(lectura("2026-10-19T00:00:00Z"), { completos: 3, dia: 3 });
  assert.deepEqual(lectura("2026-10-25T08:00:00Z"), { completos: 9, dia: 7 });
  assert.deepEqual(lectura("2026-11-20T08:00:00Z"), { completos: 35, dia: 14 });
});
