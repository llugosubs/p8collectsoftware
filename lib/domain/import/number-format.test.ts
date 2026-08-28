import { describe, expect, it } from "vitest";

import {
  NumberFormatError,
  inferDecimalConvention,
  numericCellToDecimalText,
  parseDecimalText,
} from "./number-format";

describe("deducir la convención de una columna", () => {
  it("con los dos separadores basta un valor: venezolano", () => {
    const r = inferDecimalConvention(["1.234,56"]);
    expect(r.convention).toBe("es");
    expect(r.confident).toBe(true);
  });

  it("con los dos separadores basta un valor: gringo", () => {
    const r = inferDecimalConvention(["1,234.56"]);
    expect(r.convention).toBe("us");
  });

  it("un decimal de dos dígitos resuelve la columna", () => {
    expect(inferDecimalConvention(["383,00"]).convention).toBe("es");
    expect(inferDecimalConvention(["383.00"]).convention).toBe("us");
  });

  it("un separador repetido solo puede ser de miles", () => {
    expect(inferDecimalConvention(["1.234.567"]).convention).toBe("es");
    expect(inferDecimalConvention(["1,234,567"]).convention).toBe("us");
  });

  it("un solo valor inequívoco resuelve toda la columna aunque el resto sea ambiguo", () => {
    const r = inferDecimalConvention(["1.234", "5.678", "97,77"]);
    expect(r.convention).toBe("es");
    expect(r.confident).toBe(true);
  });

  it("solo enteros: cualquier convención da lo mismo", () => {
    const r = inferDecimalConvention(["850", "320", "144"]);
    expect(r.confident).toBe(true);
  });

  it("columna entera ambigua: NO adivina, pregunta", () => {
    // "1.234" puede ser 1234 o 1,234. Adivinar mal multiplica por mil.
    const r = inferDecimalConvention(["1.234", "5.678"]);
    expect(r.confident).toBe(false);
    if (!r.confident) {
      expect(r.convention).toBeNull();
      expect(r.ambiguousSamples).toContain("1.234");
    }
  });
});

describe("interpretar un número", () => {
  it("lee formato venezolano", () => {
    expect(parseDecimalText("1.234,56", "es")).toBe("1234.56");
    expect(parseDecimalText("97,77", "es")).toBe("97.77");
    expect(parseDecimalText("1.348.920", "es")).toBe("1348920");
  });

  it("lee formato gringo", () => {
    expect(parseDecimalText("1,234.56", "us")).toBe("1234.56");
    expect(parseDecimalText("97.77", "us")).toBe("97.77");
    expect(parseDecimalText("1,348,920", "us")).toBe("1348920");
  });

  it("resuelve el caso ambiguo según la convención de la columna", () => {
    // El mismo texto, dos significados. Por eso la convención es de columna.
    expect(parseDecimalText("1.234", "es")).toBe("1234");
    expect(parseDecimalText("1.234", "us")).toBe("1.234");
  });

  it("quita símbolos de moneda y espacios", () => {
    expect(parseDecimalText("$ 1.234,56", "es")).toBe("1234.56");
    expect(parseDecimalText("US$1,234.56", "us")).toBe("1234.56");
    expect(parseDecimalText("Bs. 1.348.920", "es")).toBe("1348920");
    expect(parseDecimalText("3,3%", "es")).toBe("3.3");
  });

  it("entiende los paréntesis contables como negativo", () => {
    expect(parseDecimalText("(500)", "es")).toBe("-500");
    expect(parseDecimalText("-97,77", "es")).toBe("-97.77");
  });

  it("normaliza ceros de relleno", () => {
    expect(parseDecimalText("007", "es")).toBe("7");
    expect(parseDecimalText("10,5000", "es")).toBe("10.5");
    expect(parseDecimalText("0,00", "es")).toBe("0");
  });

  it("rechaza lo que no es un número", () => {
    for (const basura of ["", "  ", "abc", "12abc", "1..2", "—"]) {
      expect(() => parseDecimalText(basura, "es")).toThrow(NumberFormatError);
    }
  });

  it("rechaza lo que no cabe en numeric(14,4)", () => {
    // Once dígitos enteros: la columna admite diez.
    expect(() => parseDecimalText("99999999999", "es")).toThrow(NumberFormatError);
    // Cinco decimales.
    expect(() => parseDecimalText("1,23456", "es")).toThrow(NumberFormatError);
  });

  it("acepta justo el máximo", () => {
    expect(parseDecimalText("9999999999,9999", "es")).toBe("9999999999.9999");
  });
});

describe("celdas que el .xlsx ya entrega como número", () => {
  it("conserva el valor exacto", () => {
    expect(numericCellToDecimalText(383)).toBe("383");
    expect(numericCellToDecimalText(97.77)).toBe("97.77");
    expect(numericCellToDecimalText(1234.5678)).toBe("1234.5678");
  });

  it("recorta el ruido de coma flotante de Excel", () => {
    // Excel guarda 0.1+0.2 como 0.30000000000000004; más de cuatro decimales
    // es artefacto, no intención.
    expect(numericCellToDecimalText(0.1 + 0.2)).toBe("0.3");
  });

  it("expande la notación científica", () => {
    expect(numericCellToDecimalText(1e-4)).toBe("0.0001");
  });

  it("rechaza lo que no cabe", () => {
    expect(() => numericCellToDecimalText(99999999999)).toThrow(NumberFormatError);
    expect(() => numericCellToDecimalText(Number.NaN)).toThrow(NumberFormatError);
    expect(() => numericCellToDecimalText(Number.POSITIVE_INFINITY)).toThrow(NumberFormatError);
  });
});
