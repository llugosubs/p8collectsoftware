import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import type { DuplicateVerdict } from "./duplicates";
import {
  buildImportPlan,
  groupKeyOf,
  validateRow,
  type ImportRowValues,
  type PlannedItem,
} from "./plan";

const itemBase: PlannedItem = {
  type: "graded_card",
  category: "sports",
  sportOrGame: "NBA",
  playerOrCharacter: "Wembanyama",
  brand: null,
  setName: null,
  year: null,
  cardNumber: null,
  variant: null,
  serialNumbered: null,
  language: null,
  gradingCompany: "PSA",
  grade: 10,
  certNumber: null,
  rawCondition: null,
  quantity: 1,
  location: null,
  marketValue: null,
};

function fila(
  rowNumber: number,
  campos: Partial<ImportRowValues> = {},
  item: Partial<PlannedItem> = {},
): ImportRowValues {
  return {
    rowNumber,
    purchasedAt: "2026-08-14",
    platform: "alt",
    reference: "ALT-33",
    received: false,
    notes: null,
    hammerPrice: "100",
    buyerPremium: null,
    cardFeePct: null,
    shippingIntl: null,
    courierVe: null,
    customsVe: null,
    ...campos,
    item: { ...itemBase, ...item },
  };
}

const sinDuplicados = new Map<number, DuplicateVerdict>();

describe("errores que bloquean una fila", () => {
  it("una fila sin nombre no se carga", () => {
    const e = validateRow(fila(4, {}, { playerOrCharacter: null, setName: null }));
    expect(e.some((m) => /nombre/i.test(m))).toBe(true);
  });

  it("una caja sellada se identifica por su set, no por un jugador", () => {
    // Exigir siempre "jugador" rechazaría cajas perfectamente válidas.
    const e = validateRow(
      fila(4, {}, {
        type: "sealed_box",
        playerOrCharacter: null,
        setName: "Prizm 2024 Hobby",
        gradingCompany: "none",
        grade: null,
      }),
    );
    expect(e).toEqual([]);
  });

  it("un martillo que no es número bloquea", () => {
    const e = validateRow(fila(4, { hammerPrice: null }));
    expect(e.some((m) => /martillo/i.test(m))).toBe(true);
  });

  it("un grado fuera de 0 a 10 bloquea", () => {
    const e = validateRow(fila(4, {}, { grade: 11 }));
    expect(e.some((m) => /fuera de 0 a 10/.test(m))).toBe(true);
  });

  it("una gradadora sin grado bloquea aquí y no dentro de la transacción", () => {
    // La base lo exige con items_graded_needs_grade. Si llegara allá, abortaría
    // el archivo entero con las filas anteriores ya escritas.
    const e = validateRow(fila(4, {}, { gradingCompany: "BGS", grade: null }));
    expect(e.some((m) => /BGS.*grado/.test(m))).toBe(true);
  });

  it("una carta con cantidad mayor que uno bloquea", () => {
    const e = validateRow(fila(4, {}, { quantity: 3 }));
    expect(e.some((m) => /más de una unidad/.test(m))).toBe(true);
  });

  it("pero una caja con tres unidades está bien", () => {
    const e = validateRow(
      fila(4, {}, {
        type: "sealed_box",
        quantity: 3,
        setName: "Prizm",
        playerOrCharacter: null,
        gradingCompany: "none",
        grade: null,
      }),
    );
    expect(e).toEqual([]);
  });
});

describe("agrupar en lotes", () => {
  it("misma plataforma, referencia y fecha son un lote", () => {
    expect(groupKeyOf(fila(4))).toBe(groupKeyOf(fila(5)));
    expect(groupKeyOf(fila(4))).not.toBe(groupKeyOf(fila(5, { reference: "ALT-34" })));
    expect(groupKeyOf(fila(4))).not.toBe(groupKeyOf(fila(5, { purchasedAt: "2026-08-15" })));
  });

  it("dos subastas distintas producen dos lotes", () => {
    const plan = buildImportPlan({
      rows: [fila(4), fila(5, { reference: "ALT-34" })],
      duplicates: sinDuplicados,
    });
    expect(plan.groups).toHaveLength(2);
  });
});

describe("costos comunes del lote", () => {
  it("se toman de la primera fila que los trae", () => {
    // La plantilla los pide una sola vez por lote, en su primera fila.
    const plan = buildImportPlan({
      rows: [
        fila(4, { hammerPrice: "100", buyerPremium: "30", shippingIntl: "20" }),
        fila(5, { hammerPrice: "200" }),
      ],
      duplicates: sinDuplicados,
    });
    const g = plan.groups[0]!;
    expect(g.buyerPremium).toBe("30.0000");
    expect(g.shippingIntl).toBe("20.0000");
    expect(g.totalCost).toBe("350.0000");
  });

  it("avisa cuando dos filas del mismo lote se contradicen", () => {
    const plan = buildImportPlan({
      rows: [
        fila(4, { hammerPrice: "100", shippingIntl: "20" }),
        fila(5, { hammerPrice: "200", shippingIntl: "35" }),
      ],
      duplicates: sinDuplicados,
    });
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/envío/);
    expect(plan.groups[0]!.shippingIntl).toBe("20.0000");
  });

  it("un costo común ilegible bloquea su fila en vez de valer cero", () => {
    // Dejarlo pasar como cero perdería plata del lote en silencio: el costo de
    // cada carta saldría más bajo de lo que de verdad fue.
    const e = validateRow(fila(4, { shippingIntl: "veinte dólares" }));
    expect(e.some((m) => /envío/i.test(m))).toBe(true);
  });

  it("los montos del lote salen a la escala de la base", () => {
    const plan = buildImportPlan({
      rows: [fila(4, { hammerPrice: "100", shippingIntl: "20" })],
      duplicates: sinDuplicados,
    });
    expect(plan.groups[0]!.shippingIntl).toBe("20.0000");
    expect(plan.groups[0]!.courierVe).toBe("0.0000");
  });

  it("el fee de tarjeta viene como porcentaje y sale como monto", () => {
    const plan = buildImportPlan({
      rows: [
        fila(4, { hammerPrice: "100", buyerPremium: "30", cardFeePct: "3.3" }),
        fila(5, { hammerPrice: "200" }),
      ],
      duplicates: sinDuplicados,
    });
    // (300 + 30) × 3,3 % = 10,89
    expect(plan.groups[0]!.cardFee).toBe("10.8900");
    expect(plan.groups[0]!.totalCost).toBe("340.8900");
  });
});

describe("el prorrateo del plan", () => {
  it("las piezas suman exactamente lo que costó el lote", () => {
    const plan = buildImportPlan({
      rows: [
        fila(4, { hammerPrice: "100", shippingIntl: "10" }),
        fila(5, { hammerPrice: "200" }),
        fila(6, { hammerPrice: "300" }),
      ],
      duplicates: sinDuplicados,
    });
    const g = plan.groups[0]!;
    const suma = g.lines.reduce((acc, l) => acc.plus(l.allocatedCost), new Decimal(0));
    expect(suma.toFixed(4)).toBe(g.totalCost);
  });

  it("numera las líneas en el orden en que vienen del archivo", () => {
    const plan = buildImportPlan({
      rows: [fila(9), fila(4), fila(7)],
      duplicates: sinDuplicados,
    });
    expect(plan.groups[0]!.lines.map((l) => [l.rowNumber, l.lineNumber])).toEqual([
      [9, 1],
      [4, 2],
      [7, 3],
    ]);
  });
});

describe("filas que quedan fuera", () => {
  it("una duplicada no cuenta para el total ni recibe envío", () => {
    // Contarla inflaría el total del lote y repartiría costos entre cartas que
    // nunca se van a crear.
    const duplicados = new Map<number, DuplicateVerdict>([
      [5, { kind: "duplicate_in_db", matchedBy: "cert", itemId: "i1", sku: "P8-0001" }],
    ]);
    const plan = buildImportPlan({
      rows: [fila(4, { hammerPrice: "100", shippingIntl: "30" }), fila(5, { hammerPrice: "900" })],
      duplicates: duplicados,
    });
    const g = plan.groups[0]!;
    expect(g.lines).toHaveLength(1);
    expect(g.hammerTotal).toBe("100.0000");
    expect(g.totalCost).toBe("130.0000");
    expect(g.lines[0]!.allocatedCost).toBe("130.0000");
    expect(plan.totals.rowsSkipped).toBe(1);
  });

  it("una fila con error tampoco entra al lote", () => {
    const plan = buildImportPlan({
      rows: [fila(4, { hammerPrice: "100" }), fila(5, { hammerPrice: null })],
      duplicates: sinDuplicados,
    });
    expect(plan.groups[0]!.lines).toHaveLength(1);
    expect(plan.totals.rowsWithError).toBe(1);
    expect(plan.rows.find((r) => r.rowNumber === 5)?.errors).toHaveLength(1);
  });

  it("actualizar solo se ofrece contra una pieza que existe", () => {
    const duplicados = new Map<number, DuplicateVerdict>([
      [4, { kind: "duplicate_in_db", matchedBy: "cert", itemId: "i1", sku: "P8-0001" }],
      [5, { kind: "duplicate_in_file", matchedBy: "cert", firstRowNumber: 4 }],
    ]);
    const plan = buildImportPlan({
      rows: [fila(4), fila(5)],
      duplicates: duplicados,
      updateRowNumbers: [4, 5],
    });
    expect(plan.rows.find((r) => r.rowNumber === 4)?.state).toBe("update_existing");
    // La 5 no existe en la base: no hay nada que actualizar.
    expect(plan.rows.find((r) => r.rowNumber === 5)?.state).toBe("duplicate_in_file");
  });
});

describe("un lote recibido", () => {
  it("solo lo está si TODAS sus filas llegaron", () => {
    // Con una pendiente, dar el lote por recibido pondría en el inventario
    // disponible una carta que sigue en Estados Unidos.
    const parcial = buildImportPlan({
      rows: [fila(4, { received: true }), fila(5, { received: false })],
      duplicates: sinDuplicados,
    });
    expect(parcial.groups[0]!.received).toBe(false);

    const completo = buildImportPlan({
      rows: [fila(4, { received: true }), fila(5, { received: true })],
      duplicates: sinDuplicados,
    });
    expect(completo.groups[0]!.received).toBe(true);
  });
});
