"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canPublishItem, type ConsignmentTerms } from "@/lib/domain/inventory";
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
