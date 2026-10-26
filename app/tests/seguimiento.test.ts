import assert from "node:assert/strict";
import test from "node:test";

import { decidir, marca, ultimoEstado } from "../src/lib/seguimiento.ts";

const lectura = (dia: number, veredicto: "por_encima" | "en_linea" | "por_debajo") => ({
  estado: { dia, veredicto },
  central: 120,
  inferior: 80,
  superior: 180,
});

test("el estado se lee de la última marca del issue", () => {
  assert.equal(ultimoEstado(["sin marcas"]), null);
  const textos = [
    `abre ${marca({ dia: 3, veredicto: "en_linea" })}`,
    "un comentario a mano",
    marca({ dia: 7, veredicto: "por_debajo" }),
  ];
  assert.deepEqual(ultimoEstado(textos), { dia: 7, veredicto: "por_debajo" });
});

test("abre con la primera lectura y avisa solo cuando algo cambia", () => {
  const primera = decidir(null, lectura(3, "en_linea"), null);
  assert.equal(primera.tipo, "abrir");
  assert.match(primera.tipo === "abrir" ? primera.texto : "", /radar:en_linea:3/);

  const cambio = decidir({ dia: 3, veredicto: "en_linea" }, lectura(7, "por_debajo"), null);
  assert.equal(cambio.tipo, "comentar");
  assert.match(cambio.tipo === "comentar" ? cambio.texto : "", /Cambio de veredicto/);

  const mismoVeredicto = decidir({ dia: 3, veredicto: "en_linea" }, lectura(7, "en_linea"), null);
  assert.match(mismoVeredicto.tipo === "comentar" ? mismoVeredicto.texto : "", /Sin cambios/);

  assert.equal(
    decidir({ dia: 14, veredicto: "en_linea" }, lectura(14, "en_linea"), null).tipo,
    "nada",
  );
  assert.equal(decidir(null, null, null).tipo, "nada"); // aún no lleva 3 días
});

test("al cumplir el mes se cierra con el resultado real", () => {
  const cierre = decidir({ dia: 14, veredicto: "por_encima" }, null, 412);
  assert.equal(cierre.tipo, "cerrar");
  assert.match(cierre.tipo === "cerrar" ? cierre.texto : "", /412/);
  assert.equal(decidir(null, null, 412).tipo, "nada"); // nunca se siguió
});
