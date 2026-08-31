import { describe, expect, it } from "vitest";

import {
  DateFormatError,
  dateCellToDateOnly,
  excelSerialToDate,
  inferDateConvention,
  parseDateText,
} from "./date-format";

describe("deducir la convención de fechas de una columna", () => {
  it("un día mayor que doce resuelve la columna entera", () => {
    const r = inferDateConvention(["05/08/2026", "14/08/2026", "03/09/2026"]);
    expect(r.convention).toBe("dmy");
    expect(r.confident).toBe(true);
  });

  it("y al revés, un mes primero también se delata", () => {
    const r = inferDateConvention(["08/14/2026", "01/02/2026"]);
    expect(r.convention).toBe("mdy");
    expect(r.confident).toBe(true);
  });

  it("pregunta cuando toda la columna es ambigua", () => {
    // 08/09/2026 es 8 de septiembre o 9 de agosto. No hay cómo saberlo, y
    // suponer movería la fecha de compra un mes sin que nadie lo note.
    const r = inferDateConvention(["08/09/2026", "01/02/2026"]);
    expect(r.confident).toBe(false);
    if (!r.confident) expect(r.ambiguousSamples).toHaveLength(2);
  });

  it("no se confunde con las fechas en ISO, que no son ambiguas", () => {
    const r = inferDateConvention(["2026-08-14", "2026-09-08"]);
    expect(r.confident).toBe(true);
  });
});

describe("leer una fecha", () => {
  it("lee el ISO tal cual", () => {
    expect(parseDateText("2026-08-14", "mdy")).toBe("2026-08-14");
  });

  it("aplica la convención de la columna al caso ambiguo", () => {
    expect(parseDateText("08/09/2026", "dmy")).toBe("2026-09-08");
    expect(parseDateText("08/09/2026", "mdy")).toBe("2026-08-09");
  });

  it("lo inequívoco manda sobre la convención", () => {
    // Aunque la columna se dedujo como mes primero, 25 no es un mes.
    expect(parseDateText("25/08/2026", "mdy")).toBe("2026-08-25");
  });

  it("acepta guiones y puntos, que es como se teclea de verdad", () => {
    expect(parseDateText("14-08-2026", "dmy")).toBe("2026-08-14");
    expect(parseDateText("14.08.2026", "dmy")).toBe("2026-08-14");
  });

  it("entiende el año de dos cifras", () => {
    expect(parseDateText("14/08/26", "dmy")).toBe("2026-08-14");
  });

  it("rechaza una fecha que no existe", () => {
    expect(() => parseDateText("31/02/2026", "dmy")).toThrow(DateFormatError);
  });

  it("rechaza lo que no es una fecha", () => {
    expect(() => parseDateText("la semana pasada", "dmy")).toThrow(DateFormatError);
    expect(() => parseDateText("", "dmy")).toThrow(DateFormatError);
  });

  it("rechaza un año fuera de lo plausible", () => {
    expect(() => parseDateText("14/08/1850", "dmy")).toThrow(DateFormatError);
  });
});

describe("el número que Excel guarda por dentro", () => {
  it("convierte el serial a la fecha que muestra Excel", () => {
    // 46248 es el 14 de agosto de 2026 en la hoja.
    expect(excelSerialToDate(46248)).toBe("2026-08-14");
  });

  it("rechaza los seriales de enero de 1900", () => {
    // Ahí vive el error de bisiesto de Excel, y además no son fechas de compra.
    expect(() => excelSerialToDate(45)).toThrow(DateFormatError);
  });
});

describe("la fecha que SheetJS ya resolvió", () => {
  it("la lee en UTC, no en el huso de Caracas", () => {
    // Leerla en local y pasarla por toISOString() la correría al día anterior:
    // el mismo error de zona horaria que ya apareció en la ficha de inventario.
    expect(dateCellToDateOnly(new Date(Date.UTC(2026, 7, 14)))).toBe("2026-08-14");
  });
});
