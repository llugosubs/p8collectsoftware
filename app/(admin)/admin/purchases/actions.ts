"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { allocateAcquisitionCost, sharedCostsTotal } from "@/lib/domain/allocation";
import { toDbNumeric } from "@/lib/domain/money";
import { createClient } from "@/lib/supabase/server";
import { purchaseDraftSchema } from "@/lib/validations/purchases";

/**
 * Acciones de Compras.
 *
 * El prorrateo se RECALCULA aquí, desde los martillos validados, y se descarta
 * lo que mandó el navegador. Un Server Action es un endpoint HTTP público:
 * aceptar un `allocated_cost` del cliente dejaría que cualquiera con sesión
 * escriba la cifra que decide si una venta ganó o perdió dinero.
 */

export type CreateAcquisitionResult =
  | { ok: true; acquisitionId: string; items: number; alreadyExisted: boolean }
  | { ok: false; reason: string; detail?: string };

function codigoDeError(message: string): string {
  if (/martillo no cuadra/i.test(message)) return "HAMMER_MISMATCH";
  if (/prorrateo no cuadra/i.test(message)) return "ALLOCATION_MISMATCH";
  if (/sin líneas/i.test(message)) return "NO_LINES";
  if (/acquisitions_platform_reference_idx|duplicate key.*reference/i.test(message))
    return "DUPLICATE_REFERENCE";
  if (/items_cert_number_idx|duplicate key.*cert/i.test(message)) return "CERT_CONFLICT";
  return "FAILED";
}

export async function createAcquisition(input: unknown): Promise<CreateAcquisitionResult> {
  const parsed = purchaseDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID_INPUT", detail: parsed.error.issues[0]?.message };
  }

  const draft = parsed.data;
  const supabase = await createClient();

  const costos = {
    buyerPremium: draft.buyerPremium ?? "0",
    cardFee: draft.cardFee ?? "0",
    shippingIntl: draft.shippingIntl ?? "0",
    courierVe: draft.courierVe ?? "0",
    customsVe: draft.customsVe ?? "0",
    otherCosts: draft.otherCosts ?? "0",
  };

  let allocation;
  try {
    allocation = allocateAcquisitionCost(
      draft.lines.map((line) => ({
        id: String(line.lineNumber),
        lineNumber: line.lineNumber,
        hammerPrice: line.hammerPrice,
      })),
      costos,
    );
  } catch {
    return { ok: false, reason: "ALLOCATION_MISMATCH" };
  }

  const porLinea = new Map(allocation.lines.map((l) => [l.lineNumber, l]));

  const payload = {
    idempotency_key: draft.idempotencyKey,
    platform: draft.platform,
    reference: draft.reference || null,
    purchased_at: draft.purchasedAt,
    currency: draft.currency,
    hammer_total: toDbNumeric(allocation.hammerTotal),
    buyer_premium: costos.buyerPremium,
    card_fee: costos.cardFee,
    shipping_intl: costos.shippingIntl,
    courier_ve: costos.courierVe,
    customs_ve: costos.customsVe,
    other_costs: costos.otherCosts,
    courier_ve_ves: draft.courierVeVes ?? null,
    customs_ve_ves: draft.customsVeVes ?? null,
    local_fx_rate: draft.localFxRate ?? null,
    local_fx_rate_source: draft.localFxRate ? "bcv" : null,
    due_at: draft.dueAt ?? null,
    payment_status: draft.paymentStatus,
    received_status: draft.receivedStatus,
    notes: draft.notes || null,
    lines: draft.lines.map((line) => {
      const alloc = porLinea.get(line.lineNumber)!;
      const item = line.item;
      return {
        line_number: line.lineNumber,
        hammer_price: toDbNumeric(line.hammerPrice),
        allocated_cost: toDbNumeric(alloc.allocatedCost),
        item: {
          type: item.type,
          category: item.category,
          sport_or_game: item.sportOrGame || null,
          player_or_character: item.playerOrCharacter || null,
          brand: item.brand || null,
          set_name: item.setName || null,
          year: item.year ?? null,
          card_number: item.cardNumber || null,
          variant: item.variant || null,
          serial_numbered: item.serialNumbered || null,
          language: item.language || null,
          grading_company: item.gradingCompany,
          grade: item.grade ?? null,
          cert_number: item.certNumber || null,
          raw_condition: item.rawCondition || null,
          quantity: item.quantity,
          location: item.location || null,
          market_value: item.marketValue ?? null,
          list_price: item.listPrice ?? null,
          min_price: item.minPrice ?? null,
        },
      };
    }),
  };

  const { data, error } = await supabase.rpc("create_acquisition", { p_payload: payload });

  if (error) return { ok: false, reason: codigoDeError(error.message), detail: error.message };

  const result = data as {
    acquisition_id: string;
    item_ids: string[];
    already_existed: boolean;
  };

  revalidatePath("/admin/purchases");
  revalidatePath("/admin/inventory");

  return {
    ok: true,
    acquisitionId: result.acquisition_id,
    items: result.item_ids.length,
    alreadyExisted: result.already_existed,
  };
}

/**
 * Certs que ya están en el inventario.
 *
 * Se consulta ANTES de confirmar. Si el choque se descubriera dentro de la
 * transacción, el lote entero se revierte —correcto— pero el dueño acaba de
 * teclear quince cartas y no sabe cuál falló.
 */
export async function findCertConflicts(
  certs: readonly { gradingCompany: string; certNumber: string }[],
): Promise<string[]> {
  const limpios = certs
    .filter((c) => c.certNumber.trim() !== "" && c.gradingCompany !== "none")
    .slice(0, 500);

  if (limpios.length === 0) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("cert_number, grading_company")
    .in(
      "cert_number",
      limpios.map((c) => c.certNumber.trim()),
    )
    .is("deleted_at", null);

  const enUso = new Set(
    (data ?? []).map((row) => `${row.grading_company}:${String(row.cert_number).toUpperCase()}`),
  );

  return limpios
    .filter((c) => enUso.has(`${c.gradingCompany}:${c.certNumber.trim().toUpperCase()}`))
    .map((c) => c.certNumber.trim());
}

const receivedInput = z.object({
  acquisitionId: z.uuid(),
  status: z.enum(["pending", "in_transit", "received", "partial"]),
});

export type ReceivedResult = { ok: true; released: number } | { ok: false; reason: string };

/**
 * Cambia el estado de recepción del lote.
 *
 * Marcar recibido mueve además sus piezas de 'en tránsito' a disponibles, con
 * su fecha. Sin eso, el lote llegaría a Caracas y las quince cartas seguirían
 * invisibles como inventario.
 */
export async function setAcquisitionReceived(input: unknown): Promise<ReceivedResult> {
  const parsed = receivedInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_acquisition_received", {
    p_acquisition_id: parsed.data.acquisitionId,
    p_status: parsed.data.status,
  });

  if (error) return { ok: false, reason: "FAILED" };

  revalidatePath("/admin/purchases");
  revalidatePath(`/admin/purchases/${parsed.data.acquisitionId}`);
  revalidatePath("/admin/inventory");

  return { ok: true, released: (data as { items_released: number }).items_released };
}

/** El porcentaje de fee de tarjeta configurado, para sugerirlo en el wizard. */
export async function getCardFeePercent(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "card_fee_pct")
    .maybeSingle();

  // `settings.value` es jsonb: PostgREST lo entrega como número JSON. Se pasa a
  // string de inmediato para que no haga aritmética como float en el camino.
  return data?.value === null || data?.value === undefined ? "3.3" : String(data.value);
}

/** Total de los costos comunes, para mostrarlo sin recalcularlo en la UI. */
export async function sharedCostsPreview(costs: {
  buyerPremium: string;
  cardFee: string;
  shippingIntl: string;
  courierVe: string;
  customsVe: string;
  otherCosts: string;
}): Promise<string> {
  return toDbNumeric(sharedCostsTotal(costs));
}
