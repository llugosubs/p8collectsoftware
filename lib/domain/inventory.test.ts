import { describe, expect, it } from "vitest";

import {
  canPublishItem,
  inventoryTotals,
  segmentOf,
  unrealizedGain,
  type ValuedItem,
} from "./inventory";
import { money } from "./money";

function item(overrides: Partial<ValuedItem> = {}): ValuedItem {
  return {
    status: "in_stock",
    ownerType: "own",
    quantity: 1,
    costBasis: money("100"),
    marketValue: money("150"),
    ...overrides,
  };
}

describe("segmentos", () => {
  it("separa lo disponible de lo que viene en camino", () => {
    expect(segmentOf({ status: "in_stock", ownerType: "own" })).toBe("available");
    expect(segmentOf({ status: "listed", ownerType: "own" })).toBe("available");
    expect(segmentOf({ status: "reserved", ownerType: "own" })).toBe("available");
    expect(segmentOf({ status: "incoming", ownerType: "own" })).toBe("incoming");
  });

  it("aparta lo consignado, que está aquí pero es de otro", () => {
    expect(segmentOf({ status: "in_stock", ownerType: "consignment" })).toBe("consigned");
    expect(segmentOf({ status: "incoming", ownerType: "consignment" })).toBe("consigned");
  });

  it("aparta la caja consumida, cuyo costo ya pasó a las cartas", () => {
    expect(segmentOf({ status: "consumed", ownerType: "own" })).toBe("consumed");
  });

  it("saca del inventario lo vendido, perdido o devuelto", () => {
    for (const status of ["sold", "lost", "returned", "consigned_out"] as const) {
      expect(segmentOf({ status, ownerType: "own" })).toBe("gone");
    }
  });
});

describe("valor del inventario", () => {
  it("suma por segmento sin mezclarlos", () => {
    const totals = inventoryTotals([
      item({ costBasis: money("100"), marketValue: money("150") }),
      item({ status: "incoming", costBasis: money("50"), marketValue: money("70") }),
      item({ ownerType: "consignment", costBasis: money("999"), marketValue: money("999") }),
      item({ status: "consumed", costBasis: money("96"), marketValue: null }),
    ]);

    expect(totals.available.atCost.toFixed(2)).toBe("100.00");
    expect(totals.incoming.atCost.toFixed(2)).toBe("50.00");
    expect(totals.consigned.atCost.toFixed(2)).toBe("999.00");
    expect(totals.consumed.atCost.toFixed(2)).toBe("96.00");
  });

  it("cuenta unidades, no solo filas", () => {
    const totals = inventoryTotals([item({ quantity: 3 }), item({ quantity: 1 })]);
    expect(totals.available.items).toBe(2);
    expect(totals.available.units).toBe(4);
  });

  it("no confunde un costo que no se puede ver con un costo de cero", () => {
    // Lo que vería un staff: el RLS esconde los costos.
    const totals = inventoryTotals([
      item({ costBasis: null }),
      item({ costBasis: null }),
      item({ costBasis: null }),
    ]);

    expect(totals.available.atCost.toFixed(2)).toBe("0.00");
    expect(totals.available.itemsWithoutCost).toBe(3);
    expect(totals.available.items).toBe(3);
  });

  it("distingue una pieza sin comp de una que vale cero", () => {
    const totals = inventoryTotals([
      item({ marketValue: null }),
      item({ marketValue: money("0") }),
    ]);
    expect(totals.available.itemsWithoutMarket).toBe(1);
  });
});

describe("ganancia no realizada", () => {
  it("se calcula cuando se conocen las dos cifras", () => {
    const totals = inventoryTotals([item({ costBasis: money("100"), marketValue: money("150") })]);
    expect(unrealizedGain(totals.available)?.toFixed(2)).toBe("50.00");
  });

  it("no se inventa un número si falta alguna cifra", () => {
    const sinCosto = inventoryTotals([item({ costBasis: null })]);
    expect(unrealizedGain(sinCosto.available)).toBeNull();

    const sinComp = inventoryTotals([item({ marketValue: null })]);
    expect(unrealizedGain(sinComp.available)).toBeNull();
  });
});

describe("publicar en la tienda", () => {
  const publicable = {
    status: "in_stock" as const,
    ownerType: "own" as const,
    listPrice: money("500"),
    photoCount: 2,
  };

  it("deja publicar una carta propia lista", () => {
    expect(canPublishItem(publicable, null)).toEqual({ ok: true });
  });

  it("no publica lo que no se puede vender", () => {
    expect(canPublishItem({ ...publicable, status: "sold" }, null)).toEqual({
      ok: false,
      reason: "STATUS_NOT_SELLABLE",
    });
    expect(canPublishItem({ ...publicable, status: "consumed" }, null)).toEqual({
      ok: false,
      reason: "STATUS_NOT_SELLABLE",
    });
  });

  it("no publica sin precio", () => {
    expect(canPublishItem({ ...publicable, listPrice: null }, null)).toEqual({
      ok: false,
      reason: "NO_LIST_PRICE",
    });
    expect(canPublishItem({ ...publicable, listPrice: money("0") }, null)).toEqual({
      ok: false,
      reason: "NO_LIST_PRICE",
    });
  });

  it("no publica sin foto: una ficha sin foto no es una ficha", () => {
    expect(canPublishItem({ ...publicable, photoCount: 0 }, null)).toEqual({
      ok: false,
      reason: "NO_PHOTO",
    });
  });

  it("respeta el piso pactado con el consignante", () => {
    const consignada = { ...publicable, ownerType: "consignment" as const };
    expect(canPublishItem(consignada, { agreedMinPrice: money("600") })).toEqual({
      ok: false,
      reason: "BELOW_CONSIGNOR_MIN",
    });
    expect(canPublishItem(consignada, { agreedMinPrice: money("400") })).toEqual({ ok: true });
    expect(canPublishItem(consignada, { agreedMinPrice: null })).toEqual({ ok: true });
  });

  it("no publica una consignada si no puede ver el acuerdo", () => {
    // Es lo que le pasa a un staff: el RLS le esconde el precio mínimo. La
    // respuesta correcta es negarse, nunca publicar igual.
    const consignada = { ...publicable, ownerType: "consignment" as const };
    expect(canPublishItem(consignada, "unknown")).toEqual({
      ok: false,
      reason: "CONSIGNMENT_TERMS_UNKNOWN",
    });
    expect(canPublishItem(consignada, null)).toEqual({
      ok: false,
      reason: "CONSIGNMENT_TERMS_UNKNOWN",
    });
  });
});
