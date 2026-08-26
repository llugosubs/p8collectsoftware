import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  InvalidMoneyError,
  formatMoney,
  fromDbNumeric,
  fromDbNumericOrNull,
  money,
  percentOf,
  sum,
  toCents,
  toDbNumeric,
  usdToVes,
  vesToUsd,
} from "./money";

describe("money", () => {
  it("suma exacto donde el punto flotante no lo hace", () => {
    // 0.1 + 0.2 === 0.30000000000000004 con números de JavaScript.
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
  });

  it("suma una lista vacía como cero", () => {
    expect(sum([]).toString()).toBe("0");
  });

  it("rechaza valores que no son montos", () => {
    expect(() => money("carta")).toThrow(InvalidMoneyError);
    expect(() => money(Number.NaN)).toThrow(InvalidMoneyError);
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow(InvalidMoneyError);
  });

  it("acepta string, number y Decimal", () => {
    expect(money("12.34").toString()).toBe("12.34");
    expect(money(12.34).toString()).toBe("12.34");
    expect(money(new Decimal("12.34")).toString()).toBe("12.34");
  });
});

describe("redondeo", () => {
  it("redondea a centavos hacia arriba en el empate", () => {
    expect(toCents("1.005").toFixed(2)).toBe("1.01");
    expect(toCents("2.675").toFixed(2)).toBe("2.68");
  });

  it("guarda con los cuatro decimales de numeric(14,4)", () => {
    expect(toDbNumeric("12.3")).toBe("12.3000");
    expect(toDbNumeric("12.34567")).toBe("12.3457");
  });

  it("lee un numeric normal", () => {
    expect(fromDbNumeric("47.7600").toString()).toBe("47.76");
    expect(fromDbNumeric(47.76).toString()).toBe("47.76");
  });

  it("NO convierte un NULL en cero", () => {
    // Es el defecto que este proyecto ya cometió una vez. Un costo que el RLS
    // esconde llegaba como 0.00, y con él una ganancia no realizada igual al
    // valor de mercado completo: una cifra falsa que nada delataba.
    expect(fromDbNumericOrNull(null)).toBeNull();
    expect(fromDbNumericOrNull(undefined)).toBeNull();
    expect(fromDbNumericOrNull("")).toBeNull();
  });

  it("lee un numeric presente aunque venga por la vía que admite nulos", () => {
    expect(fromDbNumericOrNull("47.7600")?.toString()).toBe("47.76");
    expect(fromDbNumericOrNull("0")?.toString()).toBe("0");
  });

  it("distingue un cero real de un dato ausente", () => {
    // Un costo de cero es una afirmación: la pieza no costó nada.
    // Un costo ausente es otra cosa: no se sabe, o no se puede ver.
    expect(fromDbNumericOrNull("0")).not.toBeNull();
    expect(fromDbNumericOrNull(null)).toBeNull();
  });
});

describe("porcentajes", () => {
  it("aplica el fee de tarjeta por defecto (3.3%)", () => {
    expect(toCents(percentOf("1000", "3.3")).toFixed(2)).toBe("33.00");
  });

  it("no pierde precisión en cadenas de porcentajes", () => {
    const hammer = money("383.00");
    const premium = percentOf(hammer, "20");
    const cardFee = percentOf(hammer.plus(premium), "3.3");
    expect(toCents(hammer.plus(premium).plus(cardFee)).toFixed(2)).toBe("474.77");
  });
});

describe("conversión de moneda", () => {
  it("convierte bolívares a dólares a la tasa dada", () => {
    expect(toCents(vesToUsd("3600", "36")).toFixed(2)).toBe("100.00");
  });

  it("convierte dólares a bolívares a la tasa dada", () => {
    expect(toCents(usdToVes("100", "36.5")).toFixed(2)).toBe("3650.00");
  });

  it("va y vuelve sin desviarse", () => {
    const rate = "36.7412";
    const original = money("249.99");
    const roundTrip = vesToUsd(usdToVes(original, rate), rate);
    expect(toCents(roundTrip).toFixed(2)).toBe("249.99");
  });

  it("rechaza tasas imposibles", () => {
    expect(() => vesToUsd("100", "0")).toThrow(InvalidMoneyError);
    expect(() => usdToVes("100", "-1")).toThrow(InvalidMoneyError);
  });
});

describe("formato", () => {
  const fino = "\u202f";

  it("presenta dólares con dos decimales y el símbolo delante", () => {
    expect(formatMoney("1234.5", "USD", "es-VE")).toBe(`$${fino}1.234,50`);
  });

  it("nunca muestra los cuatro decimales internos", () => {
    expect(formatMoney("10.12345", "USD", "es-VE")).toBe(`$${fino}10,12`);
  });

  it("presenta bolívares SIN decimales", () => {
    // Con la inflación venezolana los céntimos de bolívar no significan nada
    // y solo alargan la cifra en una tabla.
    expect(formatMoney("1348920.37", "VES", "es-VE")).toBe(`Bs${fino}1.348.920`);
  });

  it("redondea el bolívar al entero más cercano", () => {
    expect(formatMoney("1348920.61", "VES", "es-VE")).toBe(`Bs${fino}1.348.921`);
  });
});
