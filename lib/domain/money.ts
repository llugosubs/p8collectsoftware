import Decimal from "decimal.js";

/**
 * Dinero.
 *
 * En la base todo monto es `numeric(14,4)` — exacto, no binario. En la aplicación,
 * `Decimal`. En ningún punto un `number` de JavaScript sostiene un monto: se usa
 * solo como forma de escribir un literal, y entra a `Decimal` de inmediato.
 *
 * Cuatro decimales porque hay cifras que no son precios: tasas de cambio,
 * porcentajes de fee y costos prorrateados que se dividen entre varias líneas.
 * Al presentar y al cobrar se redondea a dos.
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/** Decimales que guarda la base: `numeric(14,4)`. */
export const DB_SCALE = 4;

/** Decimales de un monto presentable o cobrable. */
export const CENTS_SCALE = 2;

export type MoneyInput = string | number | Decimal;

export class InvalidMoneyError extends Error {
  constructor(value: unknown) {
    super(`Valor monetario inválido: ${String(value)}`);
    this.name = "InvalidMoneyError";
  }
}

/** Convierte cualquier entrada admitida en `Decimal`, o falla ruidosamente. */
export function money(value: MoneyInput): Decimal {
  if (value instanceof Decimal) {
    if (!value.isFinite()) throw new InvalidMoneyError(value);
    return value;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new InvalidMoneyError(value);
  }

  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new InvalidMoneyError(value);
  }

  if (!parsed.isFinite()) throw new InvalidMoneyError(value);
  return parsed;
}

export const ZERO = new Decimal(0);

/** Suma exacta. Una lista vacía suma cero, no `undefined`. */
export function sum(values: readonly MoneyInput[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.plus(money(value)), ZERO);
}

/** Redondea a los 4 decimales que acepta la base. */
export function toDbScale(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(DB_SCALE, Decimal.ROUND_HALF_UP);
}

/** Redondea a centavos: lo que de verdad se cobra o se paga. */
export function toCents(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(CENTS_SCALE, Decimal.ROUND_HALF_UP);
}

/** Representación para guardar en `numeric(14,4)`: string, nunca number. */
export function toDbNumeric(value: MoneyInput): string {
  return toDbScale(value).toFixed(DB_SCALE);
}

/** Lectura de un `numeric` que Postgres devuelve como string. */
export function fromDbNumeric(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return ZERO;
  return money(value);
}

/** Aplica un porcentaje: `percentOf(100, 3.3)` → 3.30. */
export function percentOf(base: MoneyInput, percent: MoneyInput): Decimal {
  return money(base).times(money(percent)).dividedBy(100);
}

/**
 * Equivalente en USD de un monto en bolívares, a la tasa dada.
 * La tasa es Bs. por dólar, como la publica el BCV.
 */
export function vesToUsd(amountVes: MoneyInput, rate: MoneyInput): Decimal {
  const divisor = money(rate);
  if (divisor.isZero() || divisor.isNegative()) {
    throw new InvalidMoneyError(`tasa ${divisor.toString()}`);
  }
  return money(amountVes).dividedBy(divisor);
}

/** Monto en bolívares equivalente a un monto en USD, a la tasa dada. */
export function usdToVes(amountUsd: MoneyInput, rate: MoneyInput): Decimal {
  const multiplier = money(rate);
  if (multiplier.isZero() || multiplier.isNegative()) {
    throw new InvalidMoneyError(`tasa ${multiplier.toString()}`);
  }
  return money(amountUsd).times(multiplier);
}

export type SupportedCurrency = "USD" | "VES";

/** Formato de presentación. Redondea a centavos: nadie lee cuatro decimales. */
export function formatMoney(
  value: MoneyInput,
  currency: SupportedCurrency = "USD",
  locale = "es-VE",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: CENTS_SCALE,
    maximumFractionDigits: CENTS_SCALE,
  }).format(toCents(value).toNumber());
}
