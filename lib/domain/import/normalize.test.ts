import { describe, expect, it } from "vitest";

import {
  deriveCategory,
  fold,
  normalizeBoolean,
  normalizeGradingCompany,
  normalizeItemType,
  normalizePlatform,
  normalizeRawCondition,
} from "./normalize";

describe("comparación de texto", () => {
  it("ignora acentos, mayúsculas y puntuación", () => {
    expect(fold("Pokémon")).toBe("pokemon");
    expect(fold("  Yu-Gi-Oh!  ")).toBe("yu gi oh");
    expect(fold("Dragon_Ball")).toBe("dragon ball");
  });
});

describe("gradadora", () => {
  it("acepta la minúscula, que es como se teclea", () => {
    // `grading_company` es el único enum del esquema en MAYÚSCULAS: sin esto,
    // un archivo que diga "psa" revienta el cast dentro de la transacción.
    expect(normalizeGradingCompany("psa")).toBe("PSA");
    expect(normalizeGradingCompany("PSA")).toBe("PSA");
    expect(normalizeGradingCompany("Beckett")).toBe("BGS");
    expect(normalizeGradingCompany("bgs")).toBe("BGS");
  });

  it("entiende que 'raw' es sin gradar", () => {
    expect(normalizeGradingCompany("Raw")).toBe("none");
    expect(normalizeGradingCompany("sin gradar")).toBe("none");
    expect(normalizeGradingCompany("")).toBe("none");
  });

  it("devuelve null ante algo que no reconoce, en vez de inventar", () => {
    expect(normalizeGradingCompany("PSX")).toBeNull();
  });
});

describe("plataforma", () => {
  it("resuelve los nombres comerciales", () => {
    expect(normalizePlatform("Fanatics Collect")).toBe("fanatics");
    expect(normalizePlatform("Alt Auctions")).toBe("alt");
    expect(normalizePlatform("Goldin Auctions")).toBe("goldin");
    expect(normalizePlatform("eBay")).toBe("ebay");
  });

  it("entiende las palabras en español", () => {
    expect(normalizePlatform("particular")).toBe("private");
    expect(normalizePlatform("Tienda")).toBe("retail");
  });
});

describe("tipo de pieza", () => {
  it("acepta español e inglés", () => {
    expect(normalizeItemType("carta graduada")).toBe("graded_card");
    expect(normalizeItemType("Graded Card")).toBe("graded_card");
    expect(normalizeItemType("caja sellada")).toBe("sealed_box");
    expect(normalizeItemType("Sealed Box")).toBe("sealed_box");
    expect(normalizeItemType("lote")).toBe("lot");
  });
});

describe("condición", () => {
  it("entiende las siglas y su nombre largo", () => {
    expect(normalizeRawCondition("nm")).toBe("NM");
    expect(normalizeRawCondition("Near Mint")).toBe("NM");
    expect(normalizeRawCondition("dañada")).toBe("DMG");
  });
});

describe("sí / no", () => {
  it("entiende cómo la gente escribe 'sí' de verdad", () => {
    for (const v of ["sí", "si", "S", "yes", "y", "TRUE", "1", "x", "ok"]) {
      expect(normalizeBoolean(v)).toBe(true);
    }
  });

  it("entiende el no", () => {
    for (const v of ["no", "N", "false", "0", ""]) {
      expect(normalizeBoolean(v)).toBe(false);
    }
  });

  it("devuelve null ante lo que no es ni una cosa ni la otra", () => {
    // "quizá" no es "no": la fila se marca para que el dueño decida.
    expect(normalizeBoolean("quizá")).toBeNull();
    expect(normalizeBoolean("pendiente")).toBeNull();
  });
});

describe("categoría", () => {
  it("deduce deportes", () => {
    expect(deriveCategory("NBA")).toBe("sports");
    expect(deriveCategory("Soccer")).toBe("sports");
    expect(deriveCategory("fútbol")).toBe("sports");
    expect(deriveCategory("MLB")).toBe("sports");
  });

  it("deduce TCG", () => {
    expect(deriveCategory("One Piece")).toBe("tcg");
    expect(deriveCategory("Pokémon")).toBe("tcg");
    expect(deriveCategory("Yu-Gi-Oh!")).toBe("tcg");
  });

  it("una columna explícita gana sobre la deducción", () => {
    expect(deriveCategory("NBA", "tcg")).toBe("tcg");
    expect(deriveCategory("Pokémon", "deportes")).toBe("sports");
  });

  it("no adivina cuando no reconoce el deporte o juego", () => {
    // Caer en "other" en silencio dejaría la pieza en el sitio equivocado del
    // inventario sin que nadie se entere. Mejor pedirle al dueño que elija.
    expect(deriveCategory("Cromos de mi liga local")).toBeNull();
    expect(deriveCategory("")).toBeNull();
    expect(deriveCategory(null)).toBeNull();
  });
});
