import { describe, expect, it } from "vitest";

import {
  AllocationError,
  allocateAcquisitionCost,
  sharedCostsTotal,
  type SharedCosts,
} from "./allocation";
import { ZERO, toDbScale } from "./money";

const SIN_COSTOS: SharedCosts = {
  buyerPremium: 0,
  cardFee: 0,
  shippingIntl: 0,
  courierVe: 0,
  customsVe: 0,
  otherCosts: 0,
};

function costos_(partial: Partial<SharedCosts>): SharedCosts {
  return { ...SIN_COSTOS, ...partial };
}

/** El invariante que no se negocia: las partes suman el todo. */
function sumaDeLineas(lines: readonly { allocatedCost: { toString(): string } }[]) {
  return lines.reduce((acc, line) => acc.plus(line.allocatedCost.toString()), ZERO);
}

describe("sharedCostsTotal", () => {
  it("suma los seis componentes del lote", () => {
    const total = sharedCostsTotal(
      costos_({ buyerPremium: "100", cardFee: "16.5", shippingIntl: "35", customsVe: "48.25" }),
    );
    expect(total.toFixed(2)).toBe("199.75");
  });
});

describe("prorrateo", () => {
  it("reparte en proporción al martillo", () => {
    const { lines } = allocateAcquisitionCost(
      [
        { id: "a", lineNumber: 1, hammerPrice: "600" },
        { id: "b", lineNumber: 2, hammerPrice: "400" },
      ],
      costos_({ buyerPremium: "100" }),
    );

    // 60% y 40% de los 100 de comisión.
    expect(lines[0]!.allocatedCost.toFixed(2)).toBe("660.00");
    expect(lines[1]!.allocatedCost.toFixed(2)).toBe("440.00");
  });

  it("cuadra exactamente cuando la división no da redonda", () => {
    // 100 repartido entre tres partes iguales: 33.3333… cada una.
    const resultado = allocateAcquisitionCost(
      [
        { id: "a", lineNumber: 1, hammerPrice: "100" },
        { id: "b", lineNumber: 2, hammerPrice: "100" },
        { id: "c", lineNumber: 3, hammerPrice: "100" },
      ],
      costos_({ buyerPremium: "100" }),
    );

    expect(sumaDeLineas(resultado.lines).toString()).toBe(resultado.grandTotal.toString());
    expect(resultado.grandTotal.toFixed(2)).toBe("400.00");
    // La última absorbe el residuo, así que no es idéntica a las otras dos.
    expect(resultado.lines[2]!.allocatedCost.toString()).not.toBe(
      resultado.lines[0]!.allocatedCost.toString(),
    );
  });

  it("mantiene el invariante con montos de subasta reales", () => {
    const resultado = allocateAcquisitionCost(
      [
        { id: "1", lineNumber: 1, hammerPrice: "383.00" },
        { id: "2", lineNumber: 2, hammerPrice: "212.50" },
        { id: "3", lineNumber: 3, hammerPrice: "640.00" },
        { id: "4", lineNumber: 4, hammerPrice: "97.77" },
        { id: "5", lineNumber: 5, hammerPrice: "1450.33" },
      ],
      costos_({
        buyerPremium: "556.32",
        cardFee: "111.26",
        shippingIntl: "85.00",
        courierVe: "62.40",
        customsVe: "203.15",
      }),
    );

    expect(sumaDeLineas(resultado.lines).toString()).toBe(resultado.grandTotal.toString());
    expect(resultado.grandTotal.toString()).toBe(
      toDbScale(resultado.hammerTotal.plus(resultado.sharedTotal)).toString(),
    );
  });

  it("le da todo el lote a una sola línea", () => {
    const { lines, grandTotal } = allocateAcquisitionCost(
      [{ id: "unica", lineNumber: 1, hammerPrice: "383" }],
      costos_({ buyerPremium: "76.6", cardFee: "15.17" }),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]!.allocatedCost.toString()).toBe(grandTotal.toString());
    expect(lines[0]!.allocatedCost.toFixed(2)).toBe("474.77");
  });

  it("sin costos comunes, cada línea cuesta su martillo", () => {
    const { lines } = allocateAcquisitionCost(
      [
        { id: "a", lineNumber: 1, hammerPrice: "120.55" },
        { id: "b", lineNumber: 2, hammerPrice: "80.45" },
      ],
      SIN_COSTOS,
    );

    expect(lines[0]!.allocatedCost.toFixed(2)).toBe("120.55");
    expect(lines[1]!.allocatedCost.toFixed(2)).toBe("80.45");
    expect(lines[0]!.sharedShare.isZero()).toBe(true);
  });

  it("reparte en partes iguales cuando no hubo martillo", () => {
    // Un lote regalado que igual costó el envío.
    const resultado = allocateAcquisitionCost(
      [
        { id: "a", lineNumber: 1, hammerPrice: "0" },
        { id: "b", lineNumber: 2, hammerPrice: "0" },
        { id: "c", lineNumber: 3, hammerPrice: "0" },
      ],
      costos_({ shippingIntl: "90" }),
    );

    expect(resultado.lines[0]!.allocatedCost.toFixed(2)).toBe("30.00");
    expect(sumaDeLineas(resultado.lines).toString()).toBe(resultado.grandTotal.toString());
  });

  it("devuelve la parte común de cada línea por separado", () => {
    const { lines } = allocateAcquisitionCost(
      [
        { id: "a", lineNumber: 1, hammerPrice: "750" },
        { id: "b", lineNumber: 2, hammerPrice: "250" },
      ],
      costos_({ buyerPremium: "200" }),
    );

    expect(lines[0]!.sharedShare.toFixed(2)).toBe("150.00");
    expect(lines[1]!.sharedShare.toFixed(2)).toBe("50.00");
  });
});

describe("entradas inválidas", () => {
  it("rechaza un lote sin líneas", () => {
    expect(() => allocateAcquisitionCost([], SIN_COSTOS)).toThrow(AllocationError);
  });

  it("rechaza un martillo negativo", () => {
    expect(() =>
      allocateAcquisitionCost([{ id: "a", lineNumber: 1, hammerPrice: "-10" }], SIN_COSTOS),
    ).toThrow(AllocationError);
  });

  it("rechaza costos comunes negativos", () => {
    expect(() =>
      allocateAcquisitionCost(
        [{ id: "a", lineNumber: 1, hammerPrice: "10" }],
        costos_({ customsVe: "-5" }),
      ),
    ).toThrow(AllocationError);
  });
});

describe("orden de las líneas", () => {
  it("reparte igual sin importar en qué orden venga el arreglo", () => {
    const costos = costos_({ buyerPremium: "100" });
    const enOrden = allocateAcquisitionCost(
      [
        { id: "a", lineNumber: 1, hammerPrice: "600" },
        { id: "b", lineNumber: 2, hammerPrice: "400" },
      ],
      costos,
    );
    const alReves = allocateAcquisitionCost(
      [
        { id: "b", lineNumber: 2, hammerPrice: "400" },
        { id: "a", lineNumber: 1, hammerPrice: "600" },
      ],
      costos,
    );

    // El residuo del redondeo tiene que caer en la misma pieza las dos veces.
    expect(alReves.lines.map((l) => [l.id, l.allocatedCost.toString()])).toEqual(
      enOrden.lines.map((l) => [l.id, l.allocatedCost.toString()]),
    );
  });

  it("rechaza un número de línea repetido", () => {
    expect(() =>
      allocateAcquisitionCost(
        [
          { id: "a", lineNumber: 1, hammerPrice: "10" },
          { id: "b", lineNumber: 1, hammerPrice: "10" },
        ],
        costos_({}),
      ),
    ).toThrow(AllocationError);
  });

  it("rechaza un número de línea que no es un entero positivo", () => {
    expect(() =>
      allocateAcquisitionCost([{ id: "a", lineNumber: 0, hammerPrice: "10" }], costos_({})),
    ).toThrow(AllocationError);
  });
});
