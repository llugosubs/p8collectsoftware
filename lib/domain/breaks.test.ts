import { describe, expect, it } from "vitest";

import { BreakSplitError, splitBreakCost, type BreakChildInput } from "./breaks";
import { ZERO } from "./money";

function hijos(cantidad: number, pesos?: readonly string[]): BreakChildInput[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    id: `c${i + 1}`,
    childNumber: i + 1,
    ...(pesos ? { weight: pesos[i]! } : {}),
  }));
}

function suma(split: ReturnType<typeof splitBreakCost>) {
  return split.children.reduce((acc, c) => acc.plus(c.allocatedCost), ZERO);
}

describe("reparto en partes iguales", () => {
  it("divide exacto cuando la división da redonda", () => {
    const split = splitBreakCost("120", hijos(4));
    expect(split.mode).toBe("equal");
    expect(split.children.map((c) => c.allocatedCost.toFixed(2))).toEqual([
      "30.00",
      "30.00",
      "30.00",
      "30.00",
    ]);
  });

  it("conserva el costo de la caja cuando no da redonda", () => {
    // 100 entre 3: 33.3333… La caja no puede perder ni ganar un centavo.
    const split = splitBreakCost("100", hijos(3));
    expect(suma(split).toString()).toBe(split.boxCost.toString());
    expect(split.boxCost.toFixed(2)).toBe("100.00");
  });

  it("le da todo a un solo hijo", () => {
    const split = splitBreakCost("96.05", hijos(1));
    expect(split.children[0]!.allocatedCost.toFixed(2)).toBe("96.05");
  });

  it("reparte una caja que costó cero sin romperse", () => {
    const split = splitBreakCost("0", hijos(5));
    expect(suma(split).toString()).toBe("0");
  });
});

describe("reparto ponderado", () => {
  it("carga más costo al hit", () => {
    // Un hit que pesa 3 contra tres cartas de relleno que pesan 1.
    const split = splitBreakCost("120", hijos(4, ["3", "1", "1", "1"]));
    expect(split.mode).toBe("weighted");
    expect(split.children[0]!.allocatedCost.toFixed(2)).toBe("60.00");
    expect(split.children[1]!.allocatedCost.toFixed(2)).toBe("20.00");
    expect(suma(split).toString()).toBe(split.boxCost.toString());
  });

  it("conserva el costo con pesos que no dividen redondo", () => {
    const split = splitBreakCost("96.05", hijos(3, ["7", "2", "1"]));
    expect(suma(split).toString()).toBe(split.boxCost.toString());
  });

  it("da lo mismo sin importar el orden del arreglo", () => {
    const enOrden = splitBreakCost("100", hijos(3, ["5", "3", "2"]));
    const alReves = splitBreakCost("100", [
      { id: "c3", childNumber: 3, weight: "2" },
      { id: "c1", childNumber: 1, weight: "5" },
      { id: "c2", childNumber: 2, weight: "3" },
    ]);
    expect(alReves.children.map((c) => [c.id, c.allocatedCost.toString()])).toEqual(
      enOrden.children.map((c) => [c.id, c.allocatedCost.toString()]),
    );
  });
});

describe("entradas inválidas", () => {
  it("rechaza un break sin cartas", () => {
    expect(() => splitBreakCost("100", [])).toThrow(BreakSplitError);
  });

  it("rechaza una caja con costo negativo", () => {
    expect(() => splitBreakCost("-1", hijos(2))).toThrow(BreakSplitError);
  });

  it("rechaza pesos a medias", () => {
    expect(() =>
      splitBreakCost("100", [
        { id: "a", childNumber: 1, weight: "2" },
        { id: "b", childNumber: 2 },
      ]),
    ).toThrow(BreakSplitError);
  });

  it("rechaza un peso cero, que dejaría a esa carta sin costo", () => {
    expect(() => splitBreakCost("100", hijos(2, ["0", "1"]))).toThrow(BreakSplitError);
  });

  it("rechaza posiciones repetidas", () => {
    expect(() =>
      splitBreakCost("100", [
        { id: "a", childNumber: 1 },
        { id: "b", childNumber: 1 },
      ]),
    ).toThrow(BreakSplitError);
  });
});
