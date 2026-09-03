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
import { extractCardsFromImage, isVisionEnabled, VisionError } from "@/lib/ai/vision";
import { buildPhotoSheet, PHOTO_SHEET_HEADERS } from "@/lib/domain/import/photo-sheet";
import { downloadGoogleSheetCsv, SheetFetchError } from "@/lib/import/fetch-sheet";
import { readSheet, listSheets, textRows, SheetReadError } from "@/lib/import/parse";
import * as XLSX from "xlsx";
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

/**
 * El mapeo de TRABAJO va por índice de columna: es lo que la hoja abierta tiene
 * delante en este momento, y `readRows` lee por posición.
 */
const mappingSchema = z.record(z.string().regex(/^\d+$/), campoSchema);

/**
 * El mapeo GUARDADO va por encabezado, nunca por posición.
 *
 * Una plantilla existe para reusarse la semana siguiente. Basta que el dueño
 * inserte una columna para que un mapeo posicional lea la aduana donde está el
 * valor de mercado: dos montos válidos, ninguna restricción que salte, y el
 * error aparece meses después en un margen que no cuadra.
 */
const mappingPorEncabezadoSchema = z.record(z.string().min(1).max(200), campoSchema);

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

/**
 * Guardia de rol explícita.
 *
 * En el resto del panel el RLS es el control completo, y basta. Aquí no: bajar
 * una hoja de Google es una petición HTTP que SALE de nuestro servidor, y eso
 * ocurre antes de que ninguna política de Postgres tenga nada que decir. Todo
 * usuario nace `viewer`, así que sin esta línea cualquiera con una cuenta
 * podría hacer que el servidor pida URLs.
 */
async function esAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  return profile?.role === "owner" || profile?.role === "admin";
}

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
      /** Dónde quedó el archivo. Es el ancla de todos los pasos siguientes. */
      storagePath: string;
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

/**
 * Trae una hoja de Google y la deja en el bucket como un archivo más.
 *
 * No hay OAuth y no hace falta: una hoja compartida por enlace se baja como
 * CSV sin credenciales. El precio —hay que decirlo, y la interfaz lo dice— es
 * que la hoja tiene que estar compartida.
 *
 * Se guarda el CSV en Storage en vez de parsearlo al vuelo para que TODO lo de
 * abajo sea idéntico al camino del Excel: el mismo `storagePath` como ancla, el
 * mismo recálculo del plan en cada paso, el mismo archivo original guardado, y
 * la misma reversión. Un segundo camino de lectura sería un segundo sitio donde
 * el prorrateo puede quedar mal.
 */
export async function importFromGoogleSheet(input: unknown): Promise<AnalyzeResult> {
  if (!(await esAdmin())) return { ok: false, reason: "FORBIDDEN" };

  const parsed = z.object({ url: z.string().min(1).max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };

  let descarga;
  try {
    descarga = await downloadGoogleSheetCsv(parsed.data.url);
  } catch (error) {
    if (error instanceof SheetFetchError) {
      return { ok: false, reason: error.code, detail: error.message };
    }
    return { ok: false, reason: "UNREACHABLE" };
  }

  const supabase = await createClient();
  const storagePath = `imports/${crypto.randomUUID()}-hoja-${descarga.sheetId.slice(0, 12)}.csv`;

  const { error } = await supabase.storage
    .from("docs")
    .upload(storagePath, new Blob([descarga.csv], { type: "text/csv" }), {
      contentType: "text/csv",
      upsert: false,
    });

  if (error) return { ok: false, reason: "UPLOAD_FAILED", detail: error.message };

  return analyzeImportFile({ storagePath });
}

// ---------------------------------------------------------------------------
// Importar por foto
// ---------------------------------------------------------------------------

/**
 * La ruta de una foto del importador, y ninguna otra.
 *
 * `docs` es un bucket privado que guarda comprobantes de pago y contratos de
 * consignación. Sin este patrón, un `storagePath` cualquiera mandaría a un
 * tercero el contenido íntegro de la captura de un Zelle. La foto de una carta
 * solo puede vivir en `imports/photos/{uuid}.webp`, y solo eso se lee.
 */
const RUTA_DE_FOTO = /^imports\/photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

const fotosSchema = z.object({
  storagePaths: z.array(z.string().regex(RUTA_DE_FOTO)).min(1).max(4),
  mode: z.enum(["slab", "lista"]).default("slab"),
  lote: z.object({
    platform: z.enum([
      "alt", "goldin", "ebay", "whatnot", "fanatics", "pwcc", "private", "retail", "other",
    ]),
    purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reference: z.string().trim().max(120).optional(),
    received: z.boolean().default(false),
    buyerPremium: z.string().max(24).optional(),
    cardFeePct: z.string().max(24).optional(),
    shippingIntl: z.string().max(24).optional(),
    courierVe: z.string().max(24).optional(),
    customsVe: z.string().max(24).optional(),
  }),
});

export async function visionStatus(): Promise<{ enabled: boolean }> {
  return { enabled: isVisionEnabled() };
}

/**
 * De fotos a una hoja, y de ahí al mismo wizard de siempre.
 *
 * No es un quinto paso ni un inyector de filas: es otra fuente del paso 1. Las
 * cartas leídas se materializan en una hoja con las columnas de la plantilla,
 * la hoja se guarda en el bucket, y `analyzeImportFile` la abre como abriría
 * un Excel del dueño. Así el camino de la foto comparte todo lo de abajo —la
 * previsualización, la transacción, la reversión— en vez de abrir un segundo
 * sitio donde el prorrateo pueda quedar mal.
 */
export async function extractFromPhotos(input: unknown): Promise<AnalyzeResult> {
  if (!(await esAdmin())) return { ok: false, reason: "FORBIDDEN" };
  if (!isVisionEnabled()) return { ok: false, reason: "VISION_DISABLED" };

  const parsed = fotosSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID_INPUT", detail: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const cartas = [];

  for (const ruta of parsed.data.storagePaths) {
    const { data, error } = await supabase.storage.from("docs").download(ruta);
    if (error || !data) return { ok: false, reason: "UNREADABLE", detail: "No se pudo abrir la foto." };

    try {
      cartas.push(
        ...(await extractCardsFromImage(await data.arrayBuffer(), "image/webp", parsed.data.mode)),
      );
    } catch (error) {
      if (error instanceof VisionError) {
        return { ok: false, reason: `VISION_${error.code}`, detail: error.message };
      }
      return { ok: false, reason: "VISION_API_ERROR" };
    }
  }

  if (cartas.length === 0) {
    return { ok: false, reason: "VISION_UNREADABLE", detail: "No se reconoció ninguna carta." };
  }

  const filas = buildPhotoSheet(cartas, parsed.data.lote);
  const hoja = XLSX.utils.aoa_to_sheet([[...PHOTO_SHEET_HEADERS], ...filas]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Fotos");
  const bytes = XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const storagePath = `imports/${crypto.randomUUID()}-fotos.xlsx`;
  const { error: subida } = await supabase.storage
    .from("docs")
    .upload(storagePath, new Blob([new Uint8Array(bytes)]), {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

  if (subida) return { ok: false, reason: "UPLOAD_FAILED", detail: subida.message };

  return analyzeImportFile({ storagePath });
}

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
      storagePath: parsed.data.storagePath,
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
  const { skus, certNumbers, references } = lookupKeys(claves);
  const encontradas = new Map<string, ExistingItem>();

  // El SKU primero: es identidad, no parecido. Un archivo que trae SKU salió
  // de nuestra propia exportación y el dueño lo bajó para editarlo.
  if (skus.length > 0) {
    const { data } = await supabase
      .from("items")
      .select("id, sku, grading_company, cert_number, card_number, grade, status")
      .is("deleted_at", null)
      .in("sku", skus);

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
        status: fila.status,
      });
    }
  }

  if (certNumbers.length > 0) {
    const { data } = await supabase
      .from("items")
      .select("id, sku, grading_company, cert_number, card_number, grade, status")
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
        status: fila.status,
      });
    }
  }

  if (references.length > 0) {
    const { data } = await supabase
      .from("items")
      .select(
        "id, sku, grading_company, cert_number, card_number, grade, status, acquisition:acquisitions!inner(platform, reference)",
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
        status: fila.status,
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
      sku: r.sku,
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
          list_price: l.item.listPrice,
          min_price: l.item.minPrice,
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
            list_price: fila?.item.listPrice ?? null,
            min_price: fila?.item.minPrice ?? null,
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
  /** { "Jugador / Personaje": "playerOrCharacter" } — por encabezado. */
  mapping: mappingPorEncabezadoSchema,
  defaultPlatform: z.string().max(30).optional(),
  decimalConvention: z.enum(["es", "us"]).optional(),
});

export type ImportTemplate = {
  id: string;
  name: string;
  mapping: Record<string, string>;
  decimalConvention: "es" | "us" | null;
  lastUsedAt: string | null;
};

/** Las plantillas guardadas, para el selector del paso 2. */
export async function listImportTemplates(): Promise<ImportTemplate[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("import_templates")
    .select("id, name, column_mapping, decimal_convention, last_used_at")
    .is("deleted_at", null)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(25);

  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    mapping: (t.column_mapping ?? {}) as Record<string, string>,
    decimalConvention: (t.decimal_convention as "es" | "us" | null) ?? null,
    lastUsedAt: t.last_used_at,
  }));
}

/** Marca cuál se usó, para que la más reciente encabece el selector. */
export async function touchImportTemplate(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  const supabase = await createClient();
  await supabase
    .from("import_templates")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id);
}

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
