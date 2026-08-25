import Decimal from "decimal.js";

import { DB_SCALE, ZERO, money, sum, toDbScale, type MoneyInput } from "./money";

/**
 * Prorrateo del costo de un lote de subasta (sección 5.2 del master prompt).
 *
 * Un lote no se paga carta por carta. Se paga un martillo por cada pieza y
 * encima un montón de costos que son del lote entero: la comisión de la casa,
 * el fee de la tarjeta, el envío internacional, el courier y la aduana. Para
 * saber si una carta se vendió con ganancia hay que repartir esos costos
 * comunes entre las piezas, en proporción a lo que costó cada una:
 *
 *   allocated_cost = hammer + (hammer / hammer_total) × costos_comunes
 *
 * La división casi nunca da exacta. Si se redondea cada línea por su lado, la
 * suma de las partes deja de ser el total del lote: aparecen o desaparecen
 * centavos, y el inventario deja de cuadrar contra lo que salió del banco.
 * Por eso la última línea absorbe el residuo. El invariante es duro:
 *
 *   suma(allocated_cost) === hammer_total + costos_comunes
 *
 * exactamente, sin margen.
 */

export type SharedCosts = {
  buyerPremium: MoneyInput;
  cardFee: MoneyInput;
  shippingIntl: MoneyInput;
  courierVe: MoneyInput;
  customsVe: MoneyInput;
  otherCosts: MoneyInput;
};

export type AllocationLine = {
  /** Identificador de la línea. Se devuelve tal cual para poder casarla. */
  id: string;
  /**
   * Posición de la línea dentro del lote, empezando en 1. Es obligatorio y la
   * función ordena por él antes de repartir.
   *
   * No es decorativo: el residuo del redondeo cae siempre en la última línea,
   * así que sin un orden estable, recalcular el mismo lote dos veces movería
   * centavos entre piezas sin que nadie pueda explicar por qué. Pedirlo aquí
   * hace imposible pasar una lista que salió de un SELECT sin ORDER BY.
   */
  lineNumber: number;
  hammerPrice: MoneyInput;
};

export type AllocatedLine = {
  id: string;
  lineNumber: number;
  hammerPrice: Decimal;
  /** Parte de los costos comunes que le tocó. */
  sharedShare: Decimal;
  /** Lo que costó la pieza en total: martillo más su parte. */
  allocatedCost: Decimal;
};

export type AllocationResult = {
  lines: AllocatedLine[];
  hammerTotal: Decimal;
  sharedTotal: Decimal;
  /** Lo que debe valer `acquisitions.total_cost`. */
  grandTotal: Decimal;
};

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationError";
  }
}

/** Suma de los costos que son del lote entero, no de una pieza. */
export function sharedCostsTotal(costs: SharedCosts): Decimal {
  return sum([
    costs.buyerPremium,
    costs.cardFee,
    costs.shippingIntl,
    costs.courierVe,
    costs.customsVe,
    costs.otherCosts,
  ]);
}

export function allocateAcquisitionCost(
  lines: readonly AllocationLine[],
  costs: SharedCosts,
): AllocationResult {
  if (lines.length === 0) {
    throw new AllocationError("Un lote sin líneas no se puede prorratear.");
  }

  const numerosVistos = new Set<number>();
  for (const line of lines) {
    if (!Number.isInteger(line.lineNumber) || line.lineNumber < 1) {
      throw new AllocationError(
        `La línea ${line.id} tiene un número de línea inválido (${line.lineNumber}).`,
      );
    }
    if (numerosVistos.has(line.lineNumber)) {
      throw new AllocationError(`El número de línea ${line.lineNumber} está repetido en el lote.`);
    }
    numerosVistos.add(line.lineNumber);
  }

  // El orden lo decide `lineNumber`, no cómo venía el arreglo.
  const ordenadas = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);

  const hammerPrices = ordenadas.map((line) => {
    const value = money(line.hammerPrice);
    if (value.isNegative()) {
      throw new AllocationError(`La línea ${line.id} tiene un martillo negativo.`);
    }
    return value;
  });

  const sharedTotal = toDbScale(sharedCostsTotal(costs));
  if (sharedTotal.isNegative()) {
    throw new AllocationError("Los costos comunes del lote no pueden ser negativos.");
  }

  const hammerTotal = toDbScale(hammerPrices.reduce<Decimal>((acc, v) => acc.plus(v), ZERO));
  const grandTotal = toDbScale(hammerTotal.plus(sharedTotal));

  // Sin martillo no hay proporción posible — un lote donde todo entró a cero,
  // por ejemplo un regalo con costos de envío. Se reparte en partes iguales.
  const splitEvenly = hammerTotal.isZero();

  const allocated: AllocatedLine[] = [];
  let running = ZERO;

  for (let index = 0; index < ordenadas.length; index += 1) {
    const line = ordenadas[index]!;
    const hammerPrice = hammerPrices[index]!;
    const isLast = index === ordenadas.length - 1;

    let allocatedCost: Decimal;

    if (isLast) {
      // La última absorbe el residuo del redondeo. Es lo que hace que la suma
      // cuadre exactamente con el total del lote.
      allocatedCost = grandTotal.minus(running);
    } else {
      const share = splitEvenly
        ? sharedTotal.dividedBy(ordenadas.length)
        : hammerPrice.dividedBy(hammerTotal).times(sharedTotal);
      allocatedCost = toDbScale(hammerPrice.plus(share));
      running = running.plus(allocatedCost);
    }

    if (allocatedCost.isNegative()) {
      throw new AllocationError(
        `El prorrateo dejó la línea ${line.id} en negativo (${allocatedCost.toFixed(DB_SCALE)}). ` +
          "Revisa los montos del lote.",
      );
    }

    allocated.push({
      id: line.id,
      lineNumber: line.lineNumber,
      hammerPrice,
      sharedShare: allocatedCost.minus(hammerPrice),
      allocatedCost,
    });
  }

  return { lines: allocated, hammerTotal, sharedTotal, grandTotal };
}
