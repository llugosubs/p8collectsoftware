import Decimal from "decimal.js";

import { ZERO, money, toDbScale, type MoneyInput } from "./money";

/**
 * Reparto del costo de una caja entre las cartas que salieron de ella
 * (sección 5.3 y 6.9 del master prompt).
 *
 * Abrir una caja no crea ni destruye dinero: mueve el costo de una pieza a
 * varias. El invariante es el mismo que el del prorrateo de un lote y es igual
 * de duro:
 *
 *   suma(costo de los hijos) === costo de la caja
 *
 * exactamente. Si no cuadra, el margen de cada carta que salga de ese break es
 * mentira, y esas cartas se venden durante meses.
 *
 * Dos modos: partes iguales (el default) o ponderado, para que los hits carguen
 * más costo que el relleno. El peso no tiene unidad ni escala fija: lo que
 * importa es la proporción entre los hijos.
 */

export type BreakChildInput = {
  /** Identificador del hijo. Se devuelve tal cual para poder casarlo. */
  id: string;
  /** Posición dentro del break, empezando en 1. Fija dónde cae el residuo. */
  childNumber: number;
  /**
   * Peso relativo. Si se omite en todos, el reparto es en partes iguales.
   * Si se pone en alguno, hay que ponerlo en todos: un peso a medias es un
   * reparto que nadie puede explicar.
   */
  weight?: MoneyInput;
};

export type BreakChildAllocation = {
  id: string;
  childNumber: number;
  allocatedCost: Decimal;
};

export type BreakSplit = {
  children: BreakChildAllocation[];
  boxCost: Decimal;
  /** 'equal' o 'weighted'. Se devuelve para poder mostrarlo y auditarlo. */
  mode: "equal" | "weighted";
};

export class BreakSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BreakSplitError";
  }
}

export function splitBreakCost(
  boxCost: MoneyInput,
  children: readonly BreakChildInput[],
): BreakSplit {
  if (children.length === 0) {
    throw new BreakSplitError("Un break sin cartas no reparte nada.");
  }

  const cost = toDbScale(boxCost);
  if (cost.isNegative()) {
    throw new BreakSplitError("El costo de la caja no puede ser negativo.");
  }

  const numerosVistos = new Set<number>();
  for (const child of children) {
    if (!Number.isInteger(child.childNumber) || child.childNumber < 1) {
      throw new BreakSplitError(
        `La carta ${child.id} tiene una posición inválida (${child.childNumber}).`,
      );
    }
    if (numerosVistos.has(child.childNumber)) {
      throw new BreakSplitError(`La posición ${child.childNumber} está repetida en el break.`);
    }
    numerosVistos.add(child.childNumber);
  }

  const conPeso = children.filter((c) => c.weight !== undefined);
  if (conPeso.length !== 0 && conPeso.length !== children.length) {
    throw new BreakSplitError(
      "O todas las cartas del break llevan peso, o ninguna. Un reparto a medias no se puede explicar.",
    );
  }

  const mode: BreakSplit["mode"] = conPeso.length === 0 ? "equal" : "weighted";
  const ordenados = [...children].sort((a, b) => a.childNumber - b.childNumber);

  const pesos = ordenados.map((child) => {
    if (child.weight === undefined) return new Decimal(1);
    const peso = money(child.weight);
    if (peso.isNegative() || peso.isZero()) {
      throw new BreakSplitError(
        `La carta ${child.id} tiene un peso inválido (${peso.toString()}). Un peso cero la dejaría sin costo y le regalaría el suyo a las demás.`,
      );
    }
    return peso;
  });

  const pesoTotal = pesos.reduce<Decimal>((acc, p) => acc.plus(p), ZERO);

  const allocations: BreakChildAllocation[] = [];
  let running = ZERO;

  for (let index = 0; index < ordenados.length; index += 1) {
    const child = ordenados[index]!;
    const peso = pesos[index]!;
    const isLast = index === ordenados.length - 1;

    // La última carta absorbe el residuo, igual que en el prorrateo de un lote.
    const allocatedCost = isLast
      ? cost.minus(running)
      : toDbScale(peso.dividedBy(pesoTotal).times(cost));

    if (!isLast) running = running.plus(allocatedCost);

    if (allocatedCost.isNegative()) {
      throw new BreakSplitError(
        `El reparto dejó a la carta ${child.id} en negativo. Revisa los pesos.`,
      );
    }

    allocations.push({ id: child.id, childNumber: child.childNumber, allocatedCost });
  }

  return { children: allocations, boxCost: cost, mode };
}
