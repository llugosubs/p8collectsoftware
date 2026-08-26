import { describe, expect, it } from "vitest";

import { money } from "./money";
import { daysAwaitingDelivery, lotPerformance, suggestCardFee } from "./purchases";

describe("fee de tarjeta", () => {
  it("sugiere el 3.3% sobre martillo más comisión", () => {
    expect(
      suggestCardFee({ hammerTotal: "1000", buyerPremium: "200", percent: "3.3" }).toFixed(2),
    ).toBe("39.60");
  });

  it("no cuenta el envío en la base", () => {
    // Si el envío contara, sobre 1000 + 200 + 100 daría 42.90.
    expect(
      suggestCardFee({ hammerTotal: "1000", buyerPremium: "200", percent: "3.3" }).toFixed(2),
    ).not.toBe("42.90");
  });

  it("con porcentaje cero no cobra nada", () => {
    expect(
      suggestCardFee({ hammerTotal: "1000", buyerPremium: "200", percent: "0" }).isZero(),
    ).toBe(true);
  });
});

describe("pagado vs mercado", () => {
  it("separa lo realizado de lo que queda", () => {
    const r = lotPerformance({
      totalCost: "1000",
      realized: "400",
      marketValues: [money("300"), money("500")],
    });
    expect(r.realized.toFixed(2)).toBe("400.00");
    expect(r.marketOfRemaining?.toFixed(2)).toBe("800.00");
    expect(r.netPosition?.toFixed(2)).toBe("200.00");
  });

  it("no inventa un valor de mercado cuando no hay ninguna valoración", () => {
    const r = lotPerformance({ totalCost: "1000", realized: "0", marketValues: [null, null] });
    expect(r.marketOfRemaining).toBeNull();
    expect(r.netPosition).toBeNull();
    expect(r.itemsWithoutMarket).toBe(2);
  });

  it("suma solo lo valorado y dice cuánto quedó fuera", () => {
    const r = lotPerformance({
      totalCost: "1000",
      realized: "0",
      marketValues: [money("300"), null, money("200")],
    });
    expect(r.marketOfRemaining?.toFixed(2)).toBe("500.00");
    expect(r.itemsWithoutMarket).toBe(1);
  });

  it("muestra la pérdida cuando el lote va mal", () => {
    const r = lotPerformance({
      totalCost: "1000",
      realized: "100",
      marketValues: [money("400")],
    });
    expect(r.netPosition?.toFixed(2)).toBe("-500.00");
  });
});

describe("lotes pagados que no llegan", () => {
  const hoy = new Date("2026-08-25T12:00:00Z");

  it("cuenta los días desde la compra", () => {
    expect(
      daysAwaitingDelivery({
        purchasedAt: "2026-08-10",
        paymentStatus: "paid",
        receivedStatus: "pending",
        today: hoy,
      }),
    ).toBe(15);
  });

  it("no alerta si todavía no se ha pagado", () => {
    expect(
      daysAwaitingDelivery({
        purchasedAt: "2026-08-10",
        paymentStatus: "pending",
        receivedStatus: "pending",
        today: hoy,
      }),
    ).toBeNull();
  });

  it("no alerta si ya llegó", () => {
    expect(
      daysAwaitingDelivery({
        purchasedAt: "2026-08-10",
        paymentStatus: "paid",
        receivedStatus: "received",
        today: hoy,
      }),
    ).toBeNull();
  });

  it("un lote comprado hoy lleva cero días", () => {
    expect(
      daysAwaitingDelivery({
        purchasedAt: "2026-08-25",
        paymentStatus: "paid",
        receivedStatus: "in_transit",
        today: hoy,
      }),
    ).toBe(0);
  });

  it("no cuenta días negativos si la fecha viene del futuro", () => {
    expect(
      daysAwaitingDelivery({
        purchasedAt: "2026-09-01",
        paymentStatus: "paid",
        receivedStatus: "pending",
        today: hoy,
      }),
    ).toBe(0);
  });
});
