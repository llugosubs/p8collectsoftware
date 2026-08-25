import type Decimal from "decimal.js";

import { ZERO } from "./money";

/**
 * Reglas del inventario: qué cuenta como existencia, cuánto vale y cuándo una
 * pieza se puede publicar en la tienda.
 */

export type ItemStatus =
  | "incoming"
  | "in_stock"
  | "listed"
  | "reserved"
  | "sold"
  | "consigned_out"
  | "returned"
  | "lost"
  | "consumed";

export type OwnerType = "own" | "consignment";

/**
 * Los cuatro segmentos que el dueño pidió ver, más el de las piezas que ya no
 * son inventario por ninguna vía.
 *
 * Van SEPARADOS a propósito y no se suman en una sola cifra. Las cajas
 * consumidas ya trasladaron su costo a las cartas que salieron, así que
 * mezclarlas contaría el mismo dinero dos veces; y lo consignado está en la
 * bóveda pero es de otro, así que sumarlo infla el patrimonio con plata ajena.
 */
export type InventorySegment = "available" | "incoming" | "consigned" | "consumed" | "gone";

export function segmentOf(item: { status: ItemStatus; ownerType: OwnerType }): InventorySegment {
  if (item.status === "consumed") return "consumed";
  if (item.status === "sold" || item.status === "returned" || item.status === "lost") return "gone";
  // Salió a consignación con un tercero: sigue siendo nuestra, pero no está aquí.
  if (item.status === "consigned_out") return "gone";
  if (item.ownerType === "consignment") return "consigned";
  if (item.status === "incoming") return "incoming";
  return "available";
}

export type ValuedItem = {
  status: ItemStatus;
  ownerType: OwnerType;
  quantity: number;
  /** Null cuando no existe o cuando el RLS lo escondió. Nunca cero por defecto. */
  costBasis: Decimal | null;
  marketValue: Decimal | null;
};

export type SegmentTotals = {
  items: number;
  /** Unidades: una fila de tres cajas selladas son tres unidades. */
  units: number;
  /** Suma de los costos CONOCIDOS. No incluye lo que no se pudo ver. */
  atCost: Decimal;
  /** Cuántas piezas no aportaron costo, sea porque no lo tienen o porque el rol no lo ve. */
  itemsWithoutCost: number;
  atMarket: Decimal;
  itemsWithoutMarket: number;
};

export type InventoryTotals = Record<InventorySegment, SegmentTotals>;

function segmentoVacio(): SegmentTotals {
  return {
    items: 0,
    units: 0,
    atCost: ZERO,
    itemsWithoutCost: 0,
    atMarket: ZERO,
    itemsWithoutMarket: 0,
  };
}

/**
 * Valor del inventario, por segmento.
 *
 * `atCost` suma solo lo que se pudo ver, y `itemsWithoutCost` dice cuánto
 * quedó fuera. La pantalla necesita las dos cifras: si de 15 piezas 15 no
 * aportaron costo, "$0.00" sería falso y hay que mostrar "sin acceso". Un
 * total que no distingue "cero" de "no lo sé" es un total que miente.
 *
 * El costo y el valor de mercado son de la FILA completa, no por unidad: una
 * fila de tres cajas que costaron 300 tiene costo 300.
 */
export function inventoryTotals(items: readonly ValuedItem[]): InventoryTotals {
  const totals: InventoryTotals = {
    available: segmentoVacio(),
    incoming: segmentoVacio(),
    consigned: segmentoVacio(),
    consumed: segmentoVacio(),
    gone: segmentoVacio(),
  };

  for (const item of items) {
    const segmento = totals[segmentOf(item)];
    segmento.items += 1;
    segmento.units += item.quantity;

    if (item.costBasis === null) {
      segmento.itemsWithoutCost += 1;
    } else {
      segmento.atCost = segmento.atCost.plus(item.costBasis);
    }

    if (item.marketValue === null) {
      segmento.itemsWithoutMarket += 1;
    } else {
      segmento.atMarket = segmento.atMarket.plus(item.marketValue);
    }
  }

  return totals;
}

/** Ganancia no realizada: solo tiene sentido si se conocen las dos cifras. */
export function unrealizedGain(segment: SegmentTotals): Decimal | null {
  if (segment.itemsWithoutCost > 0 || segment.itemsWithoutMarket > 0) return null;
  return segment.atMarket.minus(segment.atCost);
}

// ---------------------------------------------------------------------------
// Publicar en la tienda
// ---------------------------------------------------------------------------

export type PublishBlockReason =
  | "STATUS_NOT_SELLABLE"
  | "NO_LIST_PRICE"
  | "NO_PHOTO"
  | "BELOW_CONSIGNOR_MIN"
  | "CONSIGNMENT_TERMS_UNKNOWN";

export type PublishCheck = { ok: true } | { ok: false; reason: PublishBlockReason };

/**
 * Términos del acuerdo de consignación.
 *
 * `"unknown"` no es un descuido: `consignment_agreements` es admin-only por
 * RLS, así que un `staff` literalmente no puede leer el precio mínimo pactado.
 * En ese caso la respuesta es que no puede publicar — nunca "publica igual".
 * Omitir el bloqueo en silencio dejaría a un staff vendiendo la carta de un
 * tercero por debajo de lo acordado, que es lo que §6.8 prohíbe.
 */
export type ConsignmentTerms = { agreedMinPrice: Decimal | null } | "unknown";

const ESTADOS_PUBLICABLES: ReadonlySet<ItemStatus> = new Set<ItemStatus>([
  "in_stock",
  "listed",
  "reserved",
]);

export function canPublishItem(
  item: {
    status: ItemStatus;
    ownerType: OwnerType;
    listPrice: Decimal | null;
    photoCount: number;
  },
  terms: ConsignmentTerms | null,
): PublishCheck {
  if (!ESTADOS_PUBLICABLES.has(item.status)) {
    return { ok: false, reason: "STATUS_NOT_SELLABLE" };
  }

  if (item.listPrice === null || item.listPrice.lessThanOrEqualTo(0)) {
    return { ok: false, reason: "NO_LIST_PRICE" };
  }

  // Una ficha de producto sin foto no es una ficha de producto.
  if (item.photoCount < 1) {
    return { ok: false, reason: "NO_PHOTO" };
  }

  if (item.ownerType === "consignment") {
    if (terms === null || terms === "unknown") {
      return { ok: false, reason: "CONSIGNMENT_TERMS_UNKNOWN" };
    }
    if (terms.agreedMinPrice !== null && item.listPrice.lessThan(terms.agreedMinPrice)) {
      return { ok: false, reason: "BELOW_CONSIGNOR_MIN" };
    }
  }

  return { ok: true };
}
