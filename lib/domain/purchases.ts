import type Decimal from "decimal.js";

import { ZERO, money, percentOf, toDbScale, type MoneyInput } from "./money";

/**
 * Reglas de las compras que no son el prorrateo.
 */

/**
 * Fee por pagar con tarjeta (§6.10).
 *
 * Se SUGIERE, no se impone. Las casas de subasta lo calculan sobre bases
 * distintas y a veces lo redondean; el número que manda es el del estado de
 * cuenta de la tarjeta. Por eso la interfaz deja el campo editable y deja de
 * recalcular en cuanto el dueño lo toca.
 *
 * La base es martillo más comisión de la casa. El envío internacional queda
 * fuera porque suele facturarse aparte — si en tu plataforma no es así, el
 * campo es editable justamente para eso.
 */
export function suggestCardFee(input: {
  hammerTotal: MoneyInput;
  buyerPremium: MoneyInput;
  percent: MoneyInput;
}): Decimal {
  const base = money(input.hammerTotal).plus(money(input.buyerPremium));
  return toDbScale(percentOf(base, input.percent));
}

/**
 * Cuadro "pagado vs mercado" de un lote (§7.3).
 *
 * Tres cifras, no dos. Mezclar lo que ya se vendió con lo que queda en un solo
 * número esconde cuál es cuál: un lote puede verse "en ganancia" porque una
 * pieza se vendió muy bien mientras el resto está costando plata.
 *
 * `marketOfRemaining` puede ser null: si ninguna pieza del lote tiene
 * valoración, no hay cifra de mercado, y decir cero sería afirmar que no valen
 * nada.
 */
export type LotPerformance = {
  totalCost: Decimal;
  /** Lo cobrado por las piezas del lote que ya se vendieron. */
  realized: Decimal;
  /** Valor de mercado de lo que queda. Null si no hay ninguna valoración. */
  marketOfRemaining: Decimal | null;
  /** realized + marketOfRemaining − totalCost. Null si falta el mercado. */
  netPosition: Decimal | null;
  /** Cuántas piezas del lote quedan sin valorar. */
  itemsWithoutMarket: number;
};

export function lotPerformance(input: {
  totalCost: MoneyInput;
  realized: MoneyInput;
  marketValues: readonly (Decimal | null)[];
}): LotPerformance {
  const totalCost = toDbScale(input.totalCost);
  const realized = toDbScale(input.realized);

  const conValor = input.marketValues.filter((v): v is Decimal => v !== null);
  const itemsWithoutMarket = input.marketValues.length - conValor.length;

  const marketOfRemaining =
    conValor.length === 0 ? null : conValor.reduce<Decimal>((acc, v) => acc.plus(v), ZERO);

  const netPosition =
    marketOfRemaining === null ? null : realized.plus(marketOfRemaining).minus(totalCost);

  return { totalCost, realized, marketOfRemaining, netPosition, itemsWithoutMarket };
}

/**
 * Días que lleva un lote pagado sin llegar.
 *
 * Devuelve null si no se ha pagado o si ya llegó: la alerta es sobre plata que
 * salió y mercancía que no entró.
 */
export function daysAwaitingDelivery(input: {
  purchasedAt: string;
  paymentStatus: string;
  receivedStatus: string;
  today?: Date;
}): number | null {
  if (input.paymentStatus === "pending") return null;
  if (input.receivedStatus === "received") return null;

  const [year, month, day] = input.purchasedAt.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;

  const compra = Date.UTC(year, month - 1, day);
  const hoy = input.today ?? new Date();
  const hoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());

  const dias = Math.floor((hoyUtc - compra) / 86_400_000);
  return dias < 0 ? 0 : dias;
}
