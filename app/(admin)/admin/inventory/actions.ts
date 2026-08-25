"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { splitBreakCost } from "@/lib/domain/breaks";
import { canPublishItem, type ConsignmentTerms } from "@/lib/domain/inventory";
import { toDbNumeric } from "@/lib/domain/money";
import { readNullableNumeric } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";

/**
 * Acciones del inventario.
 *
 * Un Server Action es un endpoint HTTP público: valida siempre, y nunca
 * confía en que la interfaz ya haya comprobado la regla. La interfaz deshabilita
 * el botón; esto se niega de verdad.
 */

const publishInput = z.object({
  itemId: z.uuid(),
  publish: z.boolean(),
});

export type PublishResult = { ok: true; published: boolean } | { ok: false; reason: string };

export async function setItemPublished(input: unknown): Promise<PublishResult> {
  const parsed = publishInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };

  const { itemId, publish } = parsed.data;
  const supabase = await createClient();

  const { data: item, error } = await supabase
    .from("items")
    .select("id, status, owner_type, list_price, slug, consignor_id")
    .eq("id", itemId)
    .maybeSingle();

  if (error || !item) return { ok: false, reason: "NOT_FOUND" };

  // Despublicar no necesita comprobar nada: quitar algo de la tienda siempre
  // se puede, y es la salida de emergencia si algo salió mal publicado.
  if (!publish) {
    const { error: updateError } = await supabase
      .from("items")
      .update({ is_published: false })
      .eq("id", itemId);
    if (updateError) return { ok: false, reason: "UPDATE_FAILED" };
    revalidatePath(`/admin/inventory/${itemId}`);
    revalidatePath("/admin/inventory");
    return { ok: true, published: false };
  }

  const { count: photoCount } = await supabase
    .from("item_images")
    .select("id", { count: "exact", head: true })
    .eq("item_id", itemId);

  // Si es consignada, hace falta el acuerdo. Cuando el rol no puede leerlo,
  // la consulta devuelve vacío y eso NO significa "sin mínimo": significa
  // "no lo sé", y la regla de dominio se niega.
  let terms: ConsignmentTerms | null = null;
  if (item.owner_type === "consignment") {
    const { data: agreement, error: agreementError } = await supabase
      .from("consignment_agreements")
      .select("agreed_min_price")
      .eq("item_id", itemId)
      .eq("status", "active")
      .maybeSingle();

    terms =
      agreementError || !agreement
        ? "unknown"
        : { agreedMinPrice: readNullableNumeric(agreement.agreed_min_price) };
  }

  const check = canPublishItem(
    {
      status: item.status,
      ownerType: item.owner_type,
      listPrice: readNullableNumeric(item.list_price),
      photoCount: photoCount ?? 0,
    },
    terms,
  );

  if (!check.ok) return { ok: false, reason: check.reason };

  const { error: updateError } = await supabase
    .from("items")
    .update({ is_published: true, listed_at: new Date().toISOString(), status: "listed" })
    .eq("id", itemId);

  if (updateError) return { ok: false, reason: "UPDATE_FAILED" };

  revalidatePath(`/admin/inventory/${itemId}`);
  revalidatePath("/admin/inventory");
  return { ok: true, published: true };
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

const imageInput = z.object({
  itemId: z.uuid(),
  /** Ruta dentro del bucket `cards`, ya subida por el navegador. */
  storagePath: z.string().min(1).max(400),
  kind: z.enum(["front", "back", "cert", "detail"]).default("front"),
});

export type ImageResult = { ok: true } | { ok: false; reason: string };

/**
 * Registra en la ficha una foto que el navegador ya subió.
 *
 * El archivo NO pasa por aquí: un Server Action de Next tiene un cuerpo de 1 MB
 * y una foto de teléfono no cabe. El navegador sube directo al bucket con su
 * propia sesión —el RLS de storage decide si puede— y esto solo apunta la fila.
 */
export async function registerItemImage(input: unknown): Promise<ImageResult> {
  const parsed = imageInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };

  const { itemId, storagePath, kind } = parsed.data;
  const supabase = await createClient();

  // La ruta la construye el cliente, así que se comprueba que caiga dentro de
  // la carpeta de ESTE item. Sin eso, alguien podría enganchar a su ficha una
  // imagen subida a la carpeta de otro.
  if (!storagePath.startsWith(`${itemId}/`)) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("cards").getPublicUrl(storagePath);

  const { count } = await supabase
    .from("item_images")
    .select("id", { count: "exact", head: true })
    .eq("item_id", itemId);

  const { error } = await supabase.from("item_images").insert({
    item_id: itemId,
    url: publicUrl,
    kind,
    sort_order: count ?? 0,
  });

  if (error) return { ok: false, reason: "UPLOAD_FAILED" };

  revalidatePath(`/admin/inventory/${itemId}`);
  revalidatePath("/admin/inventory");
  return { ok: true };
}

const deleteImageInput = z.object({ imageId: z.uuid() });

/**
 * Quita una foto: primero el archivo, después la fila.
 *
 * Ese orden es a propósito. Si se borrara la fila primero y el archivo fallara,
 * quedaría un huérfano servido para siempre en un bucket PÚBLICO, y sin fila
 * que lo delate nadie lo encontraría. Al revés, un fallo deja la fila apuntando
 * a un archivo que ya no está — visible, molesto y reintentable.
 */
export async function deleteItemImage(input: unknown): Promise<ImageResult> {
  const parsed = deleteImageInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };

  const supabase = await createClient();

  const { data: image } = await supabase
    .from("item_images")
    .select("id, item_id, url")
    .eq("id", parsed.data.imageId)
    .maybeSingle();

  if (!image) return { ok: false, reason: "NOT_FOUND" };

  const marca = "/storage/v1/object/public/cards/";
  const indice = image.url.indexOf(marca);
  const ruta = indice >= 0 ? image.url.slice(indice + marca.length) : null;

  if (ruta) {
    const { error: storageError } = await supabase.storage.from("cards").remove([ruta]);
    if (storageError) return { ok: false, reason: "DELETE_FAILED" };
  }

  const { error } = await supabase.from("item_images").delete().eq("id", image.id);
  if (error) return { ok: false, reason: "DELETE_FAILED" };

  revalidatePath(`/admin/inventory/${image.item_id}`);
  revalidatePath("/admin/inventory");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Breaks
// ---------------------------------------------------------------------------

const breakInput = z.object({
  sourceItemId: z.uuid(),
  platform: z
    .enum(["store", "whatnot", "instagram", "tiktok", "ebay", "in_person", "other"])
    .optional(),
  revenueFromSpots: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  weighted: z.boolean().default(false),
  children: z
    .array(
      z.object({
        name: z.string().trim().max(160),
        weight: z
          .string()
          .regex(/^\d+(\.\d{1,4})?$/)
          .optional(),
      }),
    )
    .min(1)
    .max(500),
});

export type BreakResult =
  { ok: true; children: number; costAllocated: boolean } | { ok: false; reason: string };

/** Traduce el error crudo de Postgres a un código que la interfaz sabe decir. */
function codigoDeError(message: string): string {
  if (/ya se abrió|already/i.test(message)) return "ALREADY_OPENED";
  if (/Solo se abren/i.test(message)) return "NOT_A_BOX";
  if (/unidades/i.test(message)) return "MULTIPLE_UNITS";
  if (/sin cartas/i.test(message)) return "NO_CHILDREN";
  if (/no cuadra/i.test(message)) return "UNBALANCED";
  return "FAILED";
}

/**
 * Abre un break.
 *
 * El reparto lo calcula ESTE servidor con `splitBreakCost`, no el navegador: la
 * previsualización del formulario es solo pintura. Aceptar los costos del
 * cliente dejaría que cualquiera con sesión escriba el número que decide si
 * cada carta del break se vendió con ganancia.
 */
export async function openBreak(input: unknown): Promise<BreakResult> {
  const parsed = breakInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };

  const { sourceItemId, platform, revenueFromSpots, weighted, children } = parsed.data;
  const supabase = await createClient();

  // El costo de la caja puede no ser visible: un `staff` abre el break igual y
  // el reparto queda pendiente para el dueño.
  const { data: costRow } = await supabase
    .from("item_costs")
    .select("cost_basis")
    .eq("item_id", sourceItemId)
    .maybeSingle();

  const boxCost = readNullableNumeric(costRow?.cost_basis);

  let allocations: { childNumber: number; allocatedCost: string }[] = [];
  if (boxCost !== null) {
    try {
      const split = splitBreakCost(
        boxCost,
        children.map((child, index) => ({
          id: String(index),
          childNumber: index + 1,
          ...(weighted && child.weight ? { weight: child.weight } : {}),
        })),
      );
      allocations = split.children.map((c) => ({
        childNumber: c.childNumber,
        allocatedCost: toDbNumeric(c.allocatedCost),
      }));
    } catch {
      return { ok: false, reason: "UNBALANCED" };
    }
  }

  const payload = {
    source_item_id: sourceItemId,
    platform: platform ?? null,
    revenue_from_spots: revenueFromSpots ?? "0",
    children: children.map((child, index) => ({
      child_number: index + 1,
      player_or_character: child.name || null,
      type: "raw_card",
      ...(allocations[index] ? { allocated_cost: allocations[index]!.allocatedCost } : {}),
    })),
  };

  const { data, error } = await supabase.rpc("open_break", { p_payload: payload });

  if (error) return { ok: false, reason: codigoDeError(error.message) };

  const result = data as { child_ids: string[]; cost_allocated: boolean };

  revalidatePath(`/admin/inventory/${sourceItemId}`);
  revalidatePath("/admin/inventory");

  return {
    ok: true,
    children: result.child_ids.length,
    costAllocated: result.cost_allocated,
  };
}
