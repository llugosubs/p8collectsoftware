import { describe, expect, it } from "vitest";

import { escapeCsvCell, toCsv } from "./csv";

describe("inyección de fórmulas", () => {
  it("neutraliza una celda que empieza por =", () => {
    // Sin esto, Excel ejecuta la fórmula al abrir el archivo.
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
  });

  it("neutraliza también +, - y @", () => {
    expect(escapeCsvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("neutraliza el caso real: un nombre de carta malicioso", () => {
    const salida = escapeCsvCell("=cmd|' /C calc'!A0");
    expect(salida.startsWith("'")).toBe(true);
  });

  it("no toca un texto normal", () => {
    expect(escapeCsvCell("Victor Wembanyama")).toBe("Victor Wembanyama");
    expect(escapeCsvCell("113.0779")).toBe("113.0779");
  });
});

describe("escapado estándar", () => {
  it("entrecomilla lo que lleva coma", () => {
    expect(escapeCsvCell("Prizm, Silver")).toBe('"Prizm, Silver"');
  });

  it("duplica las comillas internas", () => {
    expect(escapeCsvCell('Carta "rara"')).toBe('"Carta ""rara"""');
  });

  it("entrecomilla los saltos de línea", () => {
    expect(escapeCsvCell("linea1\nlinea2")).toBe('"linea1\nlinea2"');
  });

  it("un nulo es una celda vacía, no la palabra null", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });
});

describe("archivo completo", () => {
  it("lleva BOM y CRLF para que Excel no rompa los acentos", () => {
    const csv = toCsv(["sku", "jugador"], [["P8-2026-0001", "Dončić"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("Dončić");
  });
});
