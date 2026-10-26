// Alertas del radar (workflow seguimiento.yml, una vez al día).
//
// Lee en directo los juegos de seguimiento.json con las mismas funciones que
// la app y lleva un issue por juego en el repositorio: lo abre con la primera
// lectura, comenta cuando cambia el veredicto o el día de lectura, y lo cierra
// cuando el juego cumple el mes, con las reseñas que tuvo de verdad. Quien
// siga el issue recibe el aviso por correo desde GitHub, sin servidor propio.
import { readFileSync } from "node:fs";

import { leerRadar } from "../src/lib/radar.ts";
import { decidir, ultimoEstado } from "../src/lib/seguimiento.ts";
import {
  descargarFicha,
  descargarResenas,
  diaDeLectura,
  lecturaHasta,
  MAX_PCT_PREVIAS,
  pctPrevias,
} from "../src/lib/steam.ts";
import type { DatosRadar } from "../src/lib/tipos.ts";

async function github(ruta: string, opciones: RequestInit = {}) {
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} en ${ruta}`);
  return r.json();
}

// Sin token (en local) solo se escribe lo que se haría, sin tocar GitHub.
const EN_SECO = !process.env.GITHUB_TOKEN;

async function main() {
  const radar: DatosRadar = JSON.parse(readFileSync("data/radar.json", "utf-8"));
  const juegos: { appid: number }[] = JSON.parse(readFileSync("seguimiento.json", "utf-8"));
  if (!EN_SECO) {
    // La etiqueta con la que se encuentran los issues; si ya existe, GitHub da 422.
    await github("/labels", {
      method: "POST",
      body: JSON.stringify({ name: "seguimiento", color: "1e7a52" }),
    }).catch(() => {});
  }
  const abiertos: { number: number; title: string; body: string | null }[] = EN_SECO
    ? []
    : await github("/issues?labels=seguimiento&state=open&per_page=100");

  for (const { appid } of juegos) {
    const ficha = await descargarFicha(appid);
    if (!ficha) {
      console.log(`${appid}: no es un juego ya lanzado`);
      continue;
    }
    const issue = abiertos.find((i) => i.title.endsWith(`(${appid})`));
    const textos = issue
      ? [
          issue.body ?? "",
          ...(await github(`/issues/${issue.number}/comments?per_page=100`)).map(
            (c: { body: string }) => c.body,
          ),
        ]
      : [];
    const { dias, completo } = await descargarResenas(
      appid,
      ficha.fechaLanzamiento,
      process.env.STEAM_API_KEY ?? "",
    );
    const { completos, dia } = diaDeLectura(ficha.fechaLanzamiento, new Date(), radar.dias_lectura);
    const real30d = completos >= 30 ? lecturaHasta(dias, 30).resenas : null;
    let hoy = null;
    if (
      dia !== null &&
      completo &&
      ficha.precioUsd !== null &&
      pctPrevias(dias) <= MAX_PCT_PREVIAS
    ) {
      const generos = radar.modelos[String(dia)].generos;
      const { resenas, pctPositivas } = lecturaHasta(dias, dia);
      const lectura = leerRadar(radar, {
        dia,
        resenas,
        pct_positivas: pctPositivas,
        precio_usd: ficha.precioUsd,
        genero: generos.includes(ficha.generoPrincipal) ? ficha.generoPrincipal : "Otro",
      });
      hoy = { estado: { dia, veredicto: lectura.veredicto }, ...lectura.estimacion };
    }

    const accion = decidir(ultimoEstado(textos), hoy, real30d);
    console.log(`${ficha.nombre} (${appid}): ${accion.tipo}`);
    if (EN_SECO) {
      if (accion.tipo !== "nada") console.log(accion.texto);
      continue;
    }
    if (accion.tipo === "abrir") {
      await github("/issues", {
        method: "POST",
        body: JSON.stringify({
          title: `Radar: ${ficha.nombre} (${appid})`,
          labels: ["seguimiento"],
          body: `Seguimiento de [${ficha.nombre}](https://store.steampowered.com/app/${appid}/), lanzado el ${ficha.fechaLanzamiento}. Suscríbete al issue para recibir los avisos.\n\n${accion.texto}`,
        }),
      });
    } else if (issue && (accion.tipo === "comentar" || accion.tipo === "cerrar")) {
      await github(`/issues/${issue.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: accion.texto }),
      });
      if (accion.tipo === "cerrar") {
        await github(`/issues/${issue.number}`, {
          method: "PATCH",
          body: JSON.stringify({ state: "closed" }),
        });
      }
    }
  }
}

await main();
