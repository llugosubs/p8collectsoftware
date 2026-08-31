"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { IMPORT_FIELDS, findHeaderRow, matchColumns } from "@/lib/domain/import/columns";
import {
  findDuplicates,
  lookupKeys,
  type DuplicateVerdict,
  type ExistingItem,
  type ImportRowKeys,
} from "@/lib/domain/import/duplicates";
import { buildImportPlan, type ImportPlan } from "@/lib/domain/import/plan";
import { readSheet, listSheets, textRows, SheetReadError } from "@/lib/import/parse";
import { readRows, type ColumnMapping } from "@/lib/import/rows";
import { createClient } from "@/lib/supabase/server";

/**
 * Acciones del importador.
 *
 * La regla que ordena este archivo: el servidor VUELVE A LEER el archivo en
 * cada paso y recalcula el plan desde cero. Del navegador solo se aceptan
 * decisiones —qué hoja, qué mapeo, qué filas se excluyen— nunca montos.
 *
 * Un Server Action es un endpoint HTTP público. Aceptar un `allocated_cost`
 * que llegó del cliente sería dejar que cualquiera con sesión escriba la cifra
 * que decide si una venta ganó o perdió dinero.
 */

const campoSchema = z.enum(IMPORT_FIELDS);

const mappingSchema = z.record(z.string().regex(/^\d+$/), campoSchema);

const lecturaSchema = z.object({
  storagePath: z.string().min(1).max(400),
  sheetName: z.string().max(200).optional(),
  headerRow: z.number().int().min(0).max(200),
  mapping: mappingSchema,
  decimalConvention: z.enum(["es", "us"]).optional(),
  dateConvention: z.enum(["dmy", "mdy"]).optional(),
  excludedRowNumbers: z.array(z.number().int().min(1)).max(5000).default([]),
  updateRowNumbers: z.array(z.number().int().min(1)).max(5000).default([]),
});

export type ImportActionError = { ok: false; reason: string; detail?: string };

/** El tope del bucket `docs`. Se comprueba antes de bajarlo a memoria. */
const MAX_BYTES = 20 * 1024 * 1024;

async function descargar(storagePath: string): Promise<ArrayBuffer> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("docs").download(storagePath);
  if (error || !data) throw new SheetReadError("UNREADABLE", "No se pudo bajar el archivo.");
  if (data.size > MAX_BYTES) {
    throw new SheetReadError("UNREADABLE", "El archivo pesa más de 20 MB.");
  }
  return data.arrayBuffer();
}

function aMapping(plano: Record<string, string>): ColumnMapping {
  const mapa = new Map<number, (typeof IMPORT_FIELDS)[number]>();
  for (const [indice, campo] of Object.entries(plano)) {
    mapa.set(Number(indice), campo as (typeof IMPORT_FIELDS)[number]);
  }
  return mapa;
}

function mensaje(error: unknown): string {
  if (error instanceof SheetReadError) return error.message;
  return error instanceof Error ? error.message : "Error desconocido";
}

// ---------------------------------------------------------------------------
// Paso 1 y 2 — abrir el archivo y proponer el mapeo
// ---------------------------------------------------------------------------

export type AnalyzeResult =
  | {
      ok: true;
      sheetNames: string[];
      sheetName: string;
      headerRow: number;
      /** Encabezado por columna, con el campo que se propone para cada uno. */
      columns: { index: number; header: string; field: string | null; score: number }[];
      /** Las primeras filas, para que se vea que se leyó lo correcto. */
      sample: string[][];
      truncated: boolean;
    }
  | ImportActionError;

export async function analyzeImportFile(input: unknown): Promise<AnalyzeResult> {
  const parsed = z
    .object({ storagePath: z.string().min(1).max(400), sheetName: z.string().max(200).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };

  try {
    const buffer = await descargar(parsed.data.storagePath);
    const sheetNames = listSheets(buffer);
    const grid = readSheet(buffer, parsed.data.sheetName);
    const texto = textRows(grid);

    const encabezados = findHeaderRow(texto);
    if (encabezados === null) {
      return { ok: false, reason: "NO_HEADER_ROW" };
    }

    const columns = matchColumns(encabezados.headers);

    return {
      ok: true,
      sheetNames,
      sheetName: grid.sheetName,
      headerRow: encabezados.index,
      columns,
      sample: texto.slice(encabezados.index, encabezados.index + 6),
      truncated: grid.truncated,
    };
  } catch (error) {
    return { ok: false, reason: "UNREADABLE", detail: mensaje(error) };
  }
}

// ---------------------------------------------------------------------------
// Paso 3 — validar contra la base
// ---------------------------------------------------------------------------

/** Las piezas del inventario que podrían ser las mismas que trae el archivo. */
async function buscarCandidatas(claves: readonly ImportRowKeys[]): Promise<ExistingItem[]> {
  const supabase = await createClient();
  const { certNumbers, references } = lookupKeys(claves);
  const encontradas = new Map<string, ExistingItem>();

  if (certNumbers.length > 0) {
    const { data } = await supabase
      .from("items")
      .select("id, sku, grading_company, cert_number, card_number, grade")
      .is("deleted_at", null)
      .in("cert_number", certNumbers);

    for (const fila of data ?? []) {
      encontradas.set(fila.id, {
        id: fila.id,
        sku: fila.sku,
        gradingCompany: fila.grading_company,
        certNumber: fila.cert_number,
        platform: null,
        reference: null,
        cardNumber: fila.card_number,
        grade: fila.grade,
      });
    }
  }

  if (references.length > 0) {
    const { data } = await supabase
      .from("items")
      .select(
        "id, sku, grading_company, cert_number, card_number, grade, acquisition:acquisitions!inner(platform, reference)",
      )
      .is("deleted_at", null)
      .in("acquisition.reference", references);

    for (const fila of data ?? []) {
      const acq = fila.acquisition as unknown as { platform: string; reference: string | null };
      encontradas.set(fila.id, {
        id: fila.id,
        sku: fila.sku,
        gradingCompany: fila.grading_company,
        certNumber: fila.cert_number,
        platform: acq?.platform ?? null,
        reference: acq?.reference ?? null,
        cardNumber: fila.card_number,
        grade: fila.grade,
      });
    }
  }

  return [...encontradas.values()];
}

export type PreviewResult =
  | {
      ok: true;
      plan: ImportPlan;
      decimalConvention: "es" | "us";
      dateConvention: "dmy" | "mdy";
      ambiguousNumbers: string[];
      ambiguousDates: string[];
      /** Fila del archivo → lo que se leyó de ella, para pintar la tabla. */
      preview: {
        rowNumber: number;
        name: string;
        hammerPrice: string | null;
        purchasedAt: string | null;
        reference: string | null;
        certNumber: string | null;
        duplicateSku: string | null;
      }[];
    }
  | ImportActionError;

async function leerYPlanear(input: z.infer<typeof lecturaSchema>): Promise<
  | {
      ok: true;
      plan: ImportPlan;
      leidas: ReturnType<typeof readRows>;
      duplicados: Map<number, DuplicateVerdict>;
      candidatas: ExistingItem[];
    }
  | ImportActionError
> {
  try {
    const buffer = await descargar(input.storagePath);
    const grid = readSheet(buffer, input.sheetName);

    const leidas = readRows(grid, input.headerRow, aMapping(input.mapping), {
      decimal: input.decimalConvention,
      date: input.dateConvention,
    });

    const claves: ImportRowKeys[] = leidas.rows.map((r) => ({
      rowNumber: r.rowNumber,
      gradingCompany: r.item.gradingCompany,
      certNumber: r.item.certNumber,
      platform: r.platform,
      reference: r.reference,
      cardNumber: r.item.cardNumber,
      grade: r.item.grade,
    }));

    const candidatas = await buscarCandidatas(claves);
    const duplicados = findDuplicates(claves, candidatas);

    const plan = buildImportPlan({
      rows: leidas.rows,
      duplicates: duplicados,
      excludedRowNumbers: input.excludedRowNumbers,
      updateRowNumbers: input.updateRowNumbers,
    });

    return { ok: true, plan, leidas, duplicados, candidatas };
  } catch (error) {
    return { ok: false, reason: "UNREADABLE", detail: mensaje(error) };
  }
}

export async function previewImport(input: unknown): Promise<PreviewResult> {
  const parsed = lecturaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID_INPUT", detail: parsed.error.issues[0]?.message };
  }

  const resultado = await leerYPlanear(parsed.data);
  if (!resultado.ok) return resultado;

  const porSku = new Map(resultado.candidatas.map((c) => [c.id, c.sku]));

  return {
    ok: true,
    plan: resultado.plan,
    decimalConvention: resultado.leidas.decimalConvention,
    dateConvention: resultado.leidas.dateConvention,
    ambiguousNumbers: resultado.leidas.ambiguousNumbers,
    ambiguousDates: resultado.leidas.ambiguousDates,
    preview: resultado.leidas.rows.map((r) => {
      const planeada = resultado.plan.rows.find((p) => p.rowNumber === r.rowNumber);
      return {
        rowNumber: r.rowNumber,
        name: r.item.playerOrCharacter ?? r.item.setName ?? "",
        hammerPrice: r.hammerPrice,
        purchasedAt: r.purchasedAt,
        reference: r.reference,
        certNumber: r.item.certNumber,
        duplicateSku:
          planeada?.duplicateOfItemId !== null && planeada?.duplicateOfItemId !== undefined
            ? (porSku.get(planeada.duplicateOfItemId) ?? null)
            : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Paso 4 — confirmar
// ---------------------------------------------------------------------------

const commitSchema = lecturaSchema.extend({
  fileName: z.string().min(1).max(300),
  templateId: z.uuid().optional(),
});

export type CommitResult =
  | {
      ok: true;
      batchId: string;
      rowsCreated: number;
      rowsUpdated: number;
      rowsSkipped: number;
      rowsError: number;
      acquisitions: number;
      totalInvested: string;
    }
  | ImportActionError;

export async function commitImport(input: unknown): Promise<CommitResult> {
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID_INPUT", detail: parsed.error.issues[0]?.message };
  }

  // Se relee el archivo y se recalcula el plan. Lo que dice el navegador sobre
  // montos no se usa: solo sus decisiones.
  const resultado = await leerYPlanear(parsed.data);
  if (!resultado.ok) return resultado;

  const { plan, leidas } = resultado;
  const supabase = await createClient();

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      file_url: parsed.data.storagePath,
      file_name: parsed.data.fileName,
      sheet_name: parsed.data.sheetName ?? null,
      header_row: parsed.data.headerRow + 1,
      template_id: parsed.data.templateId ?? null,
      rows_total: plan.totals.rowsTotal,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return { ok: false, reason: "BATCH_FAILED", detail: batchError?.message };
  }

  const porFila = new Map(leidas.rows.map((r) => [r.rowNumber, r]));

  const { data: filas, error: filasError } = await supabase
    .from("import_batch_rows")
    .insert(
      plan.rows.map((r) => ({
        batch_id: batch.id,
        row_number: r.rowNumber,
        raw_data: (porFila.get(r.rowNumber) ?? {}) as never,
        state: r.state,
        group_key: r.groupKey,
        duplicate_of_item_id: r.duplicateOfItemId,
        // La restricción de la base exige un motivo cuando la fila es un error.
        error_message: r.errors.length > 0 ? r.errors.join(" ") : null,
      })),
    )
    .select("id, row_number");

  if (filasError || !filas) {
    return { ok: false, reason: "ROWS_FAILED", detail: filasError?.message };
  }

  const idPorFila = new Map(filas.map((f) => [f.row_number, f.id]));

  const payload = {
    groups: plan.groups.map((g) => ({
      group_key: g.groupKey,
      idempotency_key: crypto.randomUUID(),
      platform: g.platform,
      reference: g.reference,
      purchased_at: g.purchasedAt,
      currency: "USD",
      hammer_total: g.hammerTotal,
      buyer_premium: g.buyerPremium,
      card_fee: g.cardFee,
      shipping_intl: g.shippingIntl,
      courier_ve: g.courierVe,
      customs_ve: g.customsVe,
      other_costs: g.otherCosts,
      received_status: g.received ? "received" : "pending",
      lines: g.lines.map((l) => ({
        row_id: idPorFila.get(l.rowNumber),
        line_number: l.lineNumber,
        hammer_price: l.hammerPrice,
        allocated_cost: l.allocatedCost,
        item: {
          type: l.item.type,
          category: l.item.category,
          sport_or_game: l.item.sportOrGame,
          player_or_character: l.item.playerOrCharacter,
          brand: l.item.brand,
          set_name: l.item.setName,
          year: l.item.year,
          card_number: l.item.cardNumber,
          variant: l.item.variant,
          serial_numbered: l.item.serialNumbered,
          grading_company: l.item.gradingCompany,
          grade: l.item.grade,
          cert_number: l.item.certNumber,
          raw_condition: l.item.rawCondition,
          quantity: l.item.quantity,
          location: l.item.location,
          market_value: l.item.marketValue,
        },
      })),
    })),
    updates: plan.rows
      .filter((r) => r.state === "update_existing" && r.duplicateOfItemId !== null)
      .map((r) => {
        const fila = porFila.get(r.rowNumber);
        return {
          row_id: idPorFila.get(r.rowNumber),
          item_id: r.duplicateOfItemId,
          patch: {
            market_value: fila?.item.marketValue ?? null,
            location: fila?.item.location ?? null,
            status: fila?.received === true ? "in_stock" : null,
          },
        };
      }),
    summary: {
      file_name: parsed.data.fileName,
      decimal_convention: leidas.decimalConvention,
      date_convention: leidas.dateConvention,
      warnings: plan.warnings,
    },
  };

  const { data, error } = await supabase.rpc("commit_import_batch", {
    p_batch_id: batch.id,
    p_payload: payload as never,
  });

  if (error) {
    return { ok: false, reason: "COMMIT_FAILED", detail: error.message };
  }

  const salida = data as {
    rows_created: number;
    rows_updated: number;
    rows_skipped: number;
    rows_error: number;
    summary: { acquisitions_count?: number; total_invested?: string | number };
  };

  revalidatePath("/admin/import");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/purchases");

  return {
    ok: true,
    batchId: batch.id,
    rowsCreated: salida.rows_created,
    rowsUpdated: salida.rows_updated,
    rowsSkipped: salida.rows_skipped,
    rowsError: salida.rows_error,
    acquisitions: salida.summary?.acquisitions_count ?? 0,
    totalInvested: String(salida.summary?.total_invested ?? "0"),
  };
}

// ---------------------------------------------------------------------------
// Revertir
// ---------------------------------------------------------------------------

export type RevertResult =
  | { ok: true; itemsDeleted: number; acquisitionsDeleted: number }
  | ImportActionError;

export async function revertImportBatch(batchId: string): Promise<RevertResult> {
  if (!z.uuid().safeParse(batchId).success) return { ok: false, reason: "INVALID_INPUT" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revert_import_batch", { p_batch_id: batchId });

  if (error) {
    // El mensaje de la función lista las piezas que lo impiden, una por línea.
    return { ok: false, reason: "REVERT_BLOCKED", detail: error.message };
  }

  revalidatePath("/admin/import");
  revalidatePath("/admin/inventory");

  const salida = data as { items_deleted: number; acquisitions_deleted: number };
  return {
    ok: true,
    itemsDeleted: salida.items_deleted,
    acquisitionsDeleted: salida.acquisitions_deleted,
  };
}

// ---------------------------------------------------------------------------
// Plantillas de mapeo
// ---------------------------------------------------------------------------

const plantillaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mapping: mappingSchema,
  defaultPlatform: z.string().max(30).optional(),
  decimalConvention: z.enum(["es", "us"]).optional(),
});

export async function saveImportTemplate(
  input: unknown,
): Promise<{ ok: true; id: string } | ImportActionError> {
  const parsed = plantillaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("import_templates")
    .insert({
      name: parsed.data.name,
      column_mapping: parsed.data.mapping as never,
      default_platform: (parsed.data.defaultPlatform ?? null) as never,
      decimal_convention: parsed.data.decimalConvention ?? null,
      last_used_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    const repetida = /import_templates_name_idx/.test(error?.message ?? "");
    return { ok: false, reason: repetida ? "DUPLICATE_NAME" : "SAVE_FAILED" };
  }

  revalidatePath("/admin/import");
  return { ok: true, id: data.id };
}
