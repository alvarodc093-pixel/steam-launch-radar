// Prueba de humo: arranca la app compilada (npm run build antes) y recorre
// páginas y API como lo haría un usuario. Sale con código 1 si algo falla.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PUERTO = 3999;
const BASE = `http://127.0.0.1:${PUERTO}`;
const servidor = spawn(`npx next start -p ${PUERTO}`, { shell: true, stdio: "ignore" });

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(BASE);
      return;
    } catch {
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
  throw new Error("La app no arrancó en 30 s");
}

const fallos = [];
async function comprobar(nombre, peticion, esperado, validar = () => true) {
  const respuesta = await fetch(`${BASE}${peticion.ruta}`, peticion.opciones);
  const texto = await respuesta.text();
  const ok = respuesta.status === esperado && validar(texto);
  console.log(`${ok ? "ok  " : "FALLO"} ${respuesta.status} ${nombre}`);
  if (!ok) fallos.push(nombre);
}

const post = (ruta, cuerpo) => ({
  ruta,
  opciones: {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  },
});

try {
  await esperarServidor();
  const html = (t) => t.includes("Steam Launch") && !t.includes("No se encuentran los datos");
  await comprobar("radar", { ruta: "/" }, 200, html);
  await comprobar("antes de lanzar", { ruta: "/antes-de-lanzar" }, 200, html);
  await comprobar("mercado", { ruta: "/mercado" }, 200, html);
  await comprobar("metodología", { ruta: "/metodologia" }, 200, html);
  await comprobar("página inexistente", { ruta: "/no-existe" }, 404);

  const radar = { dia: 7, resenas: 120, pct_positivas: 0.9, precio_usd: 14.99, genero: "Action" };
  await comprobar("API radar válida", post("/api/radar", radar), 200, (t) =>
    ["por_encima", "en_linea", "por_debajo"].includes(JSON.parse(t).lectura.veredicto),
  );
  await comprobar(
    "API radar con datos imposibles",
    post("/api/radar", { dia: 5, resenas: -1 }),
    400,
  );
  await comprobar("API radar sin JSON", post("/api/radar", "esto no es json"), 400);
  await comprobar(
    "API previo válida",
    post("/api/previo", { precio_usd: 9.99, genero: "Action", mes_lanzamiento: 3 }),
    200,
    (t) => typeof JSON.parse(t).lectura.superaBaseline === "boolean",
  );
  await comprobar(
    "API previo con mes 13",
    post("/api/previo", { precio_usd: 1, genero: "Action", mes_lanzamiento: 13 }),
    400,
  );
  const { ejemplos } = JSON.parse(readFileSync("data/radar.json", "utf-8"));
  await comprobar(
    "API ejemplo existente",
    { ruta: `/api/ejemplos/${ejemplos[0].appid}` },
    200,
    (t) => Array.isArray(JSON.parse(t).acumuladas),
  );
  await comprobar("API ejemplo inexistente", { ruta: "/api/ejemplos/1" }, 404);
  await comprobar("API ejemplo no numérico", { ruta: "/api/ejemplos/abc" }, 400);
} finally {
  // En Windows npx deja procesos hijos: hay que cerrar el árbol entero.
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(servidor.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    servidor.kill();
  }
}

if (fallos.length) {
  console.error(`${fallos.length} comprobaciones fallidas`);
  process.exit(1);
}
console.log("Prueba de humo superada");
