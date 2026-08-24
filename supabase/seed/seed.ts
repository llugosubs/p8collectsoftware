/**
 * Seed de desarrollo.
 *
 * Carga un lote de subasta de ejemplo con su prorrateo ya calculado, para poder
 * recorrer inventario y compras con datos que se parecen a los reales.
 *
 *   npm run seed            # contra la base local
 *   npm run seed -- --reset # borra el lote de demostración y lo vuelve a crear
 *
 * NO toca producción. Los datos de arranque que producción sí necesita —
 * ajustes, cuentas, categorías de gasto — van en las migraciones, no aquí.
 */

import { createClient } from "@supabase/supabase-js";

import { allocateAcquisitionCost, sharedCostsTotal } from "../../lib/domain/allocation";
import { toDbScale } from "../../lib/domain/money";
import { dbNumeric } from "../../lib/supabase/numeric";
import type { Database } from "../../lib/supabase/database.types";

import { DEMO_ACQUISITION, DEMO_CARDS } from "./demo-lot";

const url = process.env.SEED_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SEED_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const reset = process.argv.includes("--reset");

function isLocal(target: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(target);
}

function abort(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!url || !serviceKey) {
  abort(
    "Faltan credenciales. Necesito SEED_SUPABASE_URL y SEED_SERVICE_ROLE_KEY, " +
      "o las de .env.local.",
  );
}

// La red de seguridad: este script escribe inventario. Si se ejecuta dos veces
// contra el proyecto real, duplica cartas que no existen.
if (!isLocal(url) && process.env.SEED_ALLOW_REMOTE !== "true") {
  abort(
    `El seed apunta a ${url}, que no es una base local.\n` +
      "  Si de verdad quieres sembrar ahí, corre con SEED_ALLOW_REMOTE=true.",
  );
}

const supabase = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function slugify(parts: readonly (string | number | undefined)[]): string {
  return parts
    .filter((part): part is string | number => part !== undefined && part !== "")
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  console.log(`\nSembrando ${url}\n`);

  // --- Tasa de cambio de arranque -----------------------------------------
  const { error: fxError } = await supabase
    .from("fx_rates")
    .upsert(
      { rate_date: DEMO_ACQUISITION.purchasedAt, source: "bcv", rate: dbNumeric("36.7412") },
      { onConflict: "rate_date,source" },
    );
  if (fxError) abort(`No se pudo cargar la tasa: ${fxError.message}`);
  console.log("  ✓ tasa BCV de arranque");

  // --- ¿Ya existe el lote? -------------------------------------------------
  const { data: existing } = await supabase
    .from("acquisitions")
    .select("id")
    .eq("platform", DEMO_ACQUISITION.platform)
    .eq("reference", DEMO_ACQUISITION.reference)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing && !reset) {
    console.log(
      `\n  El lote ${DEMO_ACQUISITION.reference} ya está cargado. ` +
        "Usa --reset para rehacerlo.\n",
    );
    return;
  }

  if (existing) {
    // Los items se borran primero: acquisition_lines los referencia con
    // `on delete restrict` justamente para que nadie borre inventario vendido
    // por accidente.
    const { data: lines } = await supabase
      .from("acquisition_lines")
      .select("item_id")
      .eq("acquisition_id", existing.id);

    await supabase.from("acquisition_lines").delete().eq("acquisition_id", existing.id);
    if (lines?.length) {
      await supabase
        .from("items")
        .delete()
        .in(
          "id",
          lines.map((l) => l.item_id),
        );
    }
    await supabase.from("acquisitions").delete().eq("id", existing.id);
    console.log("  ✓ lote anterior borrado");
  }

  // --- Prorrateo ------------------------------------------------------------
  const costs = {
    buyerPremium: DEMO_ACQUISITION.buyerPremium,
    cardFee: DEMO_ACQUISITION.cardFee,
    shippingIntl: DEMO_ACQUISITION.shippingIntl,
    courierVe: DEMO_ACQUISITION.courierVe,
    customsVe: DEMO_ACQUISITION.customsVe,
    otherCosts: DEMO_ACQUISITION.otherCosts,
  };

  const allocation = allocateAcquisitionCost(
    DEMO_CARDS.map((card, index) => ({ id: String(index), hammerPrice: card.hammerPrice })),
    costs,
  );

  // --- Lote -----------------------------------------------------------------
  const { data: acquisition, error: acqError } = await supabase
    .from("acquisitions")
    .insert({
      platform: DEMO_ACQUISITION.platform,
      reference: DEMO_ACQUISITION.reference,
      purchased_at: DEMO_ACQUISITION.purchasedAt,
      currency: DEMO_ACQUISITION.currency,
      hammer_total: dbNumeric(allocation.hammerTotal),
      buyer_premium: dbNumeric(DEMO_ACQUISITION.buyerPremium),
      card_fee: dbNumeric(DEMO_ACQUISITION.cardFee),
      shipping_intl: dbNumeric(DEMO_ACQUISITION.shippingIntl),
      courier_ve: dbNumeric(DEMO_ACQUISITION.courierVe),
      customs_ve: dbNumeric(DEMO_ACQUISITION.customsVe),
      other_costs: dbNumeric(DEMO_ACQUISITION.otherCosts),
      fx_rate: dbNumeric("36.7412"),
      fx_rate_source: "bcv",
      payment_status: "paid",
      received_status: "received",
      notes: DEMO_ACQUISITION.notes,
    })
    .select("id, total_cost")
    .single();

  if (acqError || !acquisition) abort(`No se pudo crear el lote: ${acqError?.message}`);
  console.log(`  ✓ lote ${DEMO_ACQUISITION.reference} — total ${acquisition.total_cost}`);

  // --- Items, líneas, costos y valoración ----------------------------------
  let created = 0;

  for (const [index, card] of DEMO_CARDS.entries()) {
    const line = allocation.lines[index]!;

    const { data: item, error: itemError } = await supabase
      .from("items")
      .insert({
        type: card.type,
        category: card.category,
        sport_or_game: card.sportOrGame,
        player_or_character: card.playerOrCharacter,
        brand: card.brand,
        set_name: card.setName,
        year: card.year,
        card_number: card.cardNumber,
        variant: card.variant ?? null,
        serial_numbered: card.serialNumbered ?? null,
        is_rookie: card.isRookie ?? false,
        is_autograph: card.isAutograph ?? false,
        is_patch: card.isPatch ?? false,
        language: card.language,
        grading_company: card.gradingCompany,
        grade: card.grade ?? null,
        grade_label: card.gradeLabel ?? null,
        cert_number: card.certNumber ?? null,
        status: "in_stock",
        location: "Caracas",
        acquisition_id: acquisition.id,
        market_value: dbNumeric(card.marketValue),
        market_value_source: "manual",
        market_value_at: new Date(`${DEMO_ACQUISITION.purchasedAt}T12:00:00Z`).toISOString(),
        list_price: card.listPrice ? dbNumeric(card.listPrice) : null,
        min_price: card.minPrice ? dbNumeric(card.minPrice) : null,
        is_published: card.isPublished ?? false,
        slug: card.isPublished
          ? slugify([card.playerOrCharacter, card.setName, card.year, card.cardNumber, index])
          : null,
      })
      .select("id, sku")
      .single();

    if (itemError || !item) abort(`No se pudo crear el item ${index}: ${itemError?.message}`);

    const { error: lineError } = await supabase.from("acquisition_lines").insert({
      acquisition_id: acquisition.id,
      item_id: item.id,
      hammer_price: dbNumeric(card.hammerPrice),
    });
    if (lineError) abort(`No se pudo crear la línea ${index}: ${lineError.message}`);

    const { error: costError } = await supabase.from("item_costs").insert({
      item_id: item.id,
      allocated_cost: dbNumeric(line.allocatedCost),
    });
    if (costError) abort(`No se pudo crear el costo ${index}: ${costError.message}`);

    const { error: valuationError } = await supabase.from("item_valuations").insert({
      item_id: item.id,
      value: dbNumeric(card.marketValue),
      source: "manual",
      note: "Valoración inicial del seed",
    });
    if (valuationError) abort(`No se pudo valorar el item ${index}: ${valuationError.message}`);

    created += 1;
  }

  console.log(`  ✓ ${created} items con su costo prorrateado`);

  // --- El invariante --------------------------------------------------------
  // La suma de lo que costó cada pieza tiene que ser exactamente lo que se pagó
  // por el lote. Si esto falla, el prorrateo está mal y todo margen que salga
  // del sistema es mentira.
  const { data: costRows, error: sumError } = await supabase
    .from("item_costs")
    .select("allocated_cost, items!inner(acquisition_id)")
    .eq("items.acquisition_id", acquisition.id);

  if (sumError) abort(`No se pudo verificar el prorrateo: ${sumError.message}`);

  const sumaCostos = (costRows ?? []).reduce(
    (acc, row) => acc.plus(String(row.allocated_cost)),
    toDbScale(0),
  );
  const totalLote = toDbScale(String(acquisition.total_cost));

  if (!sumaCostos.equals(totalLote)) {
    abort(
      `El prorrateo no cuadra: las piezas suman ${sumaCostos.toFixed(4)} ` +
        `y el lote costó ${totalLote.toFixed(4)}.`,
    );
  }

  console.log(
    `  ✓ prorrateo cuadrado: ${sumaCostos.toFixed(2)} en ${created} piezas ` +
      `(${toDbScale(sharedCostsTotal(costs)).toFixed(2)} de costos comunes repartidos)`,
  );
  console.log("\nListo.\n");
}

main().catch((error: unknown) => {
  abort(error instanceof Error ? error.message : String(error));
});
