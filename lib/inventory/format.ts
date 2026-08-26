import type Decimal from "decimal.js";

import { formatMoney, type SupportedCurrency } from "@/lib/domain/money";
import { readNullableNumeric } from "@/lib/supabase/numeric";

/**
 * Presentación de cifras que pueden no estar.
 *
 * Hay tres estados distintos y la pantalla no puede confundirlos:
 *   · un número       → se muestra
 *   · null por RLS    → "sin acceso": el dato existe, este rol no lo ve
 *   · null por vacío  → "sin comp": nadie ha valorado esa pieza todavía
 *
 * Mostrar "$0.00" en cualquiera de los dos últimos casos sería una cifra falsa
 * que nada delata.
 */

export type MissingReason = "hidden" | "empty";

export type DisplayMoney =
  { kind: "value"; text: string; decimal: Decimal } | { kind: "missing"; reason: MissingReason };

export function displayMoney(
  raw: number | string | null | undefined,
  reasonIfMissing: MissingReason,
  currency: SupportedCurrency = "USD",
  locale = "es-VE",
): DisplayMoney {
  const value = readNullableNumeric(raw);
  if (value === null) return { kind: "missing", reason: reasonIfMissing };
  return { kind: "value", text: formatMoney(value, currency, locale), decimal: value };
}

/** El grado, tal como se lee en un slab: "PSA 10", "BGS 9.5", "Raw". */
export function formatGrade(
  gradingCompany: string | null,
  grade: number | null,
  rawCondition: string | null,
): string {
  if (!gradingCompany || gradingCompany === "none") {
    return rawCondition ?? "Raw";
  }
  if (grade === null) return gradingCompany;
  // 10 se escribe "10", no "10.0"; 9.5 sí lleva su decimal.
  const numero = Number.isInteger(grade) ? String(grade) : grade.toFixed(1);
  return `${gradingCompany} ${numero}`;
}

/** El nombre con el que uno reconoce la pieza de un vistazo. */
export function itemTitle(item: {
  player_or_character: string | null;
  set_name: string | null;
  year: number | null;
  card_number: string | null;
  variant: string | null;
}): string {
  const partes = [
    item.year ? String(item.year) : null,
    item.set_name,
    item.player_or_character,
    item.card_number ? `#${item.card_number}` : null,
    item.variant,
  ].filter(Boolean);

  return partes.length > 0 ? partes.join(" · ") : "Sin identificar";
}

/**
 * Versión serializable de una cifra, para pasarla a un componente de cliente.
 *
 * Un `Decimal` no cruza esa frontera: React lo serializaría a un objeto sin
 * métodos, y el primer `.plus()` del otro lado reventaría. Se manda el texto ya
 * formateado, que es lo único que la tabla necesita.
 */
export type MoneyView = { text: string } | { missing: MissingReason };

export function serializeMoney(value: DisplayMoney): MoneyView {
  return value.kind === "value" ? { text: value.text } : { missing: value.reason };
}

export type InventoryRowView = {
  id: string;
  sku: string;
  title: string;
  grade: string;
  type: string;
  status: string;
  ownerType: string;
  location: string | null;
  quantity: number;
  isPublished: boolean;
  cost: MoneyView;
  market: MoneyView;
  list: MoneyView;
  gain: MoneyView;
};

export function toRowView(
  row: {
    id: string;
    sku: string;
    player_or_character: string | null;
    set_name: string | null;
    year: number | null;
    card_number: string | null;
    variant: string | null;
    grading_company: string | null;
    grade: number | null;
    raw_condition: string | null;
    type: string | null;
    status: string | null;
    owner_type: string | null;
    location: string | null;
    quantity: number | null;
    is_published: boolean | null;
    cost_basis: number | null;
    market_value: number | null;
    list_price: number | null;
    unrealized_gain: number | null;
  },
  canSeeCosts: boolean,
): InventoryRowView {
  // Si el rol no ve costos, el NULL viene del RLS. Si sí los ve, el NULL
  // significa que esa pieza no tiene costo cargado. Son razones distintas y la
  // pantalla las dice distinto.
  const razonCosto: MissingReason = canSeeCosts ? "empty" : "hidden";

  return {
    id: row.id,
    sku: row.sku,
    title: itemTitle(row),
    grade: formatGrade(row.grading_company, row.grade, row.raw_condition),
    type: row.type ?? "raw_card",
    status: row.status ?? "in_stock",
    ownerType: row.owner_type ?? "own",
    location: row.location,
    quantity: row.quantity ?? 1,
    isPublished: row.is_published ?? false,
    cost: serializeMoney(displayMoney(row.cost_basis, razonCosto)),
    market: serializeMoney(displayMoney(row.market_value, "empty")),
    list: serializeMoney(displayMoney(row.list_price, "empty")),
    gain: serializeMoney(displayMoney(row.unrealized_gain, razonCosto)),
  };
}

/**
 * Fechas.
 *
 * Postgres tiene dos tipos y se muestran distinto. Un `date` —como
 * `acquisitions.purchased_at`— no tiene hora ni zona: es el día que dice, y
 * punto. Pasarlo por `new Date("2026-08-14")` lo interpreta como medianoche
 * UTC y al mostrarlo en Caracas (UTC−4) retrocede al 13. El dueño vería que
 * compró un día antes de lo que compró.
 *
 * Un `timestamptz` sí es un instante y sí debe mostrarse en la zona de quien
 * mira.
 */

/** Para columnas `date`: se muestra el día tal cual, sin convertir zona. */
export function formatDateOnly(value: string | null | undefined, locale = "es-VE"): string | null {
  if (!value) return null;
  const soloFecha = value.slice(0, 10);
  const [year, month, day] = soloFecha.split("-").map(Number);
  if (!year || !month || !day) return null;
  // dd/mm/yyyy con dos dígitos, como pide la guía de marca: en una columna de
  // fechas, "1/8/2026" y "14/8/2026" no alinean.
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(locale, {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Para columnas `timestamptz`: un instante, mostrado donde está quien mira. */
export function formatInstant(value: string | null | undefined, locale = "es-VE"): string | null {
  if (!value) return null;
  // Zona horaria de Caracas, fijada: el panel se mira desde ahí, y dejarlo al
  // navegador haría que el mismo dato se viera distinto en otro huso.
  return new Date(value).toLocaleDateString(locale, {
    timeZone: "America/Caracas",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
