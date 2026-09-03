import { describe, expect, it } from "vitest";

import { buildPhotoSheet, PHOTO_SHEET_HEADERS, type CabeceraLote, type CartaLeida } from "./photo-sheet";

const vacia: CartaLeida = {
  playerOrCharacter: null,
  sportOrGame: null,
  brand: null,
  setName: null,
  year: null,
  cardNumber: null,
  variant: null,
  serialNumbered: null,
  gradingCompany: "ninguna",
  grade: null,
  certNumber: null,
  rawCondition: "desconocida",
  hammerPrice: null,
  notes: null,
};

const lote: CabeceraLote = {
  platform: "alt",
  purchasedAt: "2026-08-14",
  reference: "ALT-90",
  received: true,
  shippingIntl: "45",
  cardFeePct: "3,3",
};

function columna(filas: string[][], nombre: (typeof PHOTO_SHEET_HEADERS)[number]) {
  const i = PHOTO_SHEET_HEADERS.indexOf(nombre);
  return filas.map((f) => f[i]);
}

describe("la hoja que arma una foto", () => {
  const cartas: CartaLeida[] = [
    { ...vacia, playerOrCharacter: "Wembanyama", gradingCompany: "PSA", grade: "10" },
    { ...vacia, playerOrCharacter: "Luffy", gradingCompany: "PSA", grade: "9.5" },
  ];

  it("repite la cabecera del lote en todas las filas", () => {
    // El agrupamiento se hace fila por fila por (plataforma, referencia,
    // fecha): dejarlas en blanco partiría el lote en pedazos.
    const filas = buildPhotoSheet(cartas, lote);
    expect(columna(filas, "plataforma")).toEqual(["alt", "alt"]);
    expect(columna(filas, "fecha_compra")).toEqual(["2026-08-14", "2026-08-14"]);
    expect(columna(filas, "referencia_subasta")).toEqual(["ALT-90", "ALT-90"]);
  });

  it("repite 'recibido' en todas, porque el lote solo llegó si TODAS llegaron", () => {
    // Escribirlo únicamente arriba dejaría el lote entero en tránsito.
    expect(columna(buildPhotoSheet(cartas, lote), "recibido")).toEqual(["sí", "sí"]);
  });

  it("pone los costos comunes SOLO en la primera fila", () => {
    // Es la convención de la plantilla y lo que el planificador espera.
    const filas = buildPhotoSheet(cartas, lote);
    expect(columna(filas, "envio_usd")).toEqual(["45", ""]);
    expect(columna(filas, "fee_tarjeta_pct")).toEqual(["3,3", ""]);
  });

  it("transcribe el grado sin tocarlo", () => {
    expect(columna(buildPhotoSheet(cartas, lote), "grado")).toEqual(["10", "9.5"]);
  });

  it("una etiqueta ilegible se escribe 'ilegible' y para la fila", () => {
    // Escribir "" la haría pasar como carta sin gradar —con su grado puesto— y
    // un slab PSA 10 entraría al inventario como carta suelta.
    const filas = buildPhotoSheet(
      [{ ...vacia, gradingCompany: "ilegible", grade: "10" }],
      lote,
    );
    expect(columna(filas, "gradadora")).toEqual(["ilegible"]);
    expect(columna(filas, "tipo")).toEqual(["carta graduada"]);
  });

  it("una carta sin encapsular queda como raw y sin gradadora", () => {
    const filas = buildPhotoSheet([{ ...vacia, gradingCompany: "ninguna" }], lote);
    expect(columna(filas, "gradadora")).toEqual([""]);
    expect(columna(filas, "tipo")).toEqual(["carta raw"]);
  });

  it("no inventa columnas de costo por carta", () => {
    // El esquema de extracción ni siquiera declara los costos comunes: no hay
    // camino, ni alucinado, de una foto a un prorrateo.
    const filas = buildPhotoSheet(cartas, { ...lote, shippingIntl: undefined });
    expect(columna(filas, "envio_usd")).toEqual(["", ""]);
  });

  it("cada fila tiene tantas celdas como encabezados", () => {
    for (const fila of buildPhotoSheet(cartas, lote)) {
      expect(fila).toHaveLength(PHOTO_SHEET_HEADERS.length);
    }
  });
});
