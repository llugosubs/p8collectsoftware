import { describe, expect, it } from "vitest";

import { findHeaderRow, matchColumns } from "./columns";

function campos(headers: readonly string[]) {
  return Object.fromEntries(matchColumns(headers).map((m) => [m.header, m.field]));
}

describe("reconocer encabezados", () => {
  it("reconoce la plantilla oficial tal cual", () => {
    const plantilla = [
      "fecha_compra",
      "plataforma",
      "referencia_subasta",
      "tipo",
      "deporte_o_juego",
      "jugador_o_personaje",
      "marca",
      "set",
      "año",
      "numero",
      "variante",
      "serial",
      "gradadora",
      "grado",
      "cert",
      "condicion_raw",
      "cantidad",
      "hammer_usd",
      "premium_usd",
      "fee_tarjeta_pct",
      "envio_usd",
      "courier_ve_usd",
      "aduana_usd",
      "valor_mercado_usd",
      "recibido",
      "ubicacion",
      "notas",
    ];
    const resultado = matchColumns(plantilla);
    const sinReconocer = resultado.filter((m) => m.field === null).map((m) => m.header);
    expect(sinReconocer).toEqual([]);
  });

  it("reconoce encabezados en inglés", () => {
    const m = campos(["Player", "Grade", "Cert", "Hammer", "Market Value", "Purchase Date"]);
    expect(m["Player"]).toBe("playerOrCharacter");
    expect(m["Grade"]).toBe("grade");
    expect(m["Cert"]).toBe("certNumber");
    expect(m["Hammer"]).toBe("hammerPrice");
    expect(m["Market Value"]).toBe("marketValue");
    expect(m["Purchase Date"]).toBe("purchasedAt");
  });

  it("aguanta mayúsculas, acentos y separadores raros", () => {
    const m = campos(["JUGADOR / PERSONAJE", "  Año  ", "Valor de Mercado (USD)", "Ubicación"]);
    expect(m["JUGADOR / PERSONAJE"]).toBe("playerOrCharacter");
    expect(m["  Año  "]).toBe("year");
    expect(m["Valor de Mercado (USD)"]).toBe("marketValue");
    expect(m["Ubicación"]).toBe("location");
  });

  it("no propone el mismo campo dos veces", () => {
    // Dos columnas que se parecen a "jugador": gana una, la otra queda para
    // que el dueño decida. Repartir el mismo dato en dos sitios es peor.
    const resultado = matchColumns(["Jugador", "Player"]);
    const asignados = resultado.filter((m) => m.field === "playerOrCharacter");
    expect(asignados).toHaveLength(1);
  });

  it("deja sin proponer lo que no reconoce, en vez de forzar", () => {
    const m = campos(["Comprador", "Mi columna rara", "xyz123"]);
    expect(m["Mi columna rara"]).toBeNull();
    expect(m["xyz123"]).toBeNull();
  });

  it("distingue el envío del courier y de la aduana", () => {
    const m = campos(["envio_usd", "courier_ve_usd", "aduana_usd"]);
    expect(m["envio_usd"]).toBe("shippingIntl");
    expect(m["courier_ve_usd"]).toBe("courierVe");
    expect(m["aduana_usd"]).toBe("customsVe");
  });

  it("no confunde el martillo con el valor de mercado", () => {
    const m = campos(["hammer_usd", "valor_mercado_usd"]);
    expect(m["hammer_usd"]).toBe("hammerPrice");
    expect(m["valor_mercado_usd"]).toBe("marketValue");
  });
});

describe("encontrar la fila de encabezados", () => {
  it("la encuentra aunque haya basura arriba", () => {
    // Un Excel de verdad: título, fila vacía, y después la tabla.
    const filas = [
      ["Lote Alt — agosto 2026", "", "", ""],
      ["", "", "", ""],
      ["jugador", "grado", "cert", "hammer_usd"],
      ["Luffy", "10", "118442901", "383.00"],
    ];
    const r = findHeaderRow(filas);
    expect(r?.index).toBe(2);
    expect(r?.headers).toContain("cert");
  });

  it("la encuentra en la primera fila cuando no hay basura", () => {
    const filas = [
      ["jugador", "grado", "cert"],
      ["Luffy", "10", "118442901"],
    ];
    expect(findHeaderRow(filas)?.index).toBe(0);
  });

  it("devuelve null cuando ninguna fila parece encabezados", () => {
    const filas = [
      ["a", "b", "c"],
      ["1", "2", "3"],
    ];
    expect(findHeaderRow(filas)).toBeNull();
  });

  it("no confunde un título largo con la fila de encabezados", () => {
    const filas = [
      ["Compras de la semana del 20 al 26 de agosto", "", ""],
      ["jugador", "grado", "hammer_usd"],
    ];
    expect(findHeaderRow(filas)?.index).toBe(1);
  });
});
