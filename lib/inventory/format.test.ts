import { describe, expect, it } from "vitest";

import { formatDateOnly, formatGrade, formatInstant, itemTitle } from "./format";

describe("fechas", () => {
  it("muestra un `date` en su propio día, sin retroceder por zona horaria", () => {
    // El error que este proyecto ya cometió: `new Date("2026-08-14")` es
    // medianoche UTC, y en Caracas (UTC−4) se ve como el 13.
    expect(formatDateOnly("2026-08-14", "es-VE")).toBe("14/08/2026");
    expect(formatDateOnly("2026-01-01", "es-VE")).toBe("01/01/2026");
  });

  it("acepta un timestamp completo y se queda con el día", () => {
    expect(formatDateOnly("2026-08-14T00:00:00+00:00", "es-VE")).toBe("14/08/2026");
  });

  it("devuelve null cuando no hay fecha", () => {
    expect(formatDateOnly(null)).toBeNull();
    expect(formatDateOnly(undefined)).toBeNull();
    expect(formatDateOnly("")).toBeNull();
    expect(formatInstant(null)).toBeNull();
  });
});

describe("grado", () => {
  it("se lee como en el slab", () => {
    expect(formatGrade("PSA", 10, null)).toBe("PSA 10");
    expect(formatGrade("BGS", 9.5, null)).toBe("BGS 9.5");
  });

  it("una carta sin gradar muestra su condición", () => {
    expect(formatGrade("none", null, "NM")).toBe("NM");
    expect(formatGrade(null, null, null)).toBe("Raw");
  });
});

describe("título de la pieza", () => {
  it("arma el nombre con el que uno la reconoce", () => {
    expect(
      itemTitle({
        player_or_character: "Victor Wembanyama",
        set_name: "Prizm",
        year: 2023,
        card_number: "136",
        variant: "Silver Prizm",
      }),
    ).toBe("2023 · Prizm · Victor Wembanyama · #136 · Silver Prizm");
  });

  it("no queda vacío aunque falte todo", () => {
    expect(
      itemTitle({
        player_or_character: null,
        set_name: null,
        year: null,
        card_number: null,
        variant: null,
      }),
    ).toBe("Sin identificar");
  });
});
