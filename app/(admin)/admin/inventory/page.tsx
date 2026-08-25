import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { InventoryFilters } from "@/components/inventory/inventory-filters";
import { InventoryGrid } from "@/components/inventory/inventory-grid";
import { InventoryPagination } from "@/components/inventory/inventory-pagination";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { InventoryTotalsPanel } from "@/components/inventory/inventory-totals";
import { ViewSwitch } from "@/components/inventory/view-switch";
import { inventoryTotals } from "@/lib/domain/inventory";
import { toRowView } from "@/lib/inventory/format";
import { parseInventoryParams } from "@/lib/inventory/params";
import { fetchInventoryPage, fetchInventoryValuation } from "@/lib/inventory/query";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.inventory");
  return { title: t("title") };
}

/** Los roles que pueden ver costos. Es el mismo conjunto que `is_admin()` en SQL. */
const ROLES_CON_COSTOS = new Set(["owner", "admin"]);

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin.inventory");
  const params = parseInventoryParams(await searchParams);

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const canSeeCosts = ROLES_CON_COSTOS.has(profile?.role ?? "");

  // Dos consultas, no una: la página trae solo las filas que se ven, y la
  // valoración recorre TODO lo que cumple el filtro. El número que dice si el
  // negocio va bien no puede estar truncado a la primera página.
  const [page, valuation] = await Promise.all([
    fetchInventoryPage(supabase, params, { canSeeCosts }),
    fetchInventoryValuation(supabase, params, { canSeeCosts }),
  ]);

  const rows = page.rows.map((row) => toRowView(row, canSeeCosts));
  const totals = inventoryTotals(valuation);

  // Las fotos se piden aparte para no cargar el constructor de consulta con un
  // embed que la tabla no usa.
  const photos = new Map<string, string>();
  if (params.view === "grid" && rows.length > 0) {
    const { data: images } = await supabase
      .from("item_images")
      .select("item_id,url,sort_order")
      .in(
        "item_id",
        rows.map((r) => r.id),
      )
      .order("sort_order", { ascending: true });

    for (const image of images ?? []) {
      if (!photos.has(image.item_id)) photos.set(image.item_id, image.url);
    }
  }

  const sinNada = page.total === 0 && !params.q && !params.type && !params.status;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>

      <InventoryTotalsPanel totals={totals} />

      <div className="flex flex-wrap items-center gap-2">
        <InventoryFilters canSeeCosts={canSeeCosts} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-sm tabular-nums">
            {t("results", { count: page.total })}
          </span>
          <ViewSwitch />
        </div>
      </div>

      {page.total === 0 ? (
        <div className="border-border rounded border border-dashed py-16 text-center">
          <p className="text-muted-foreground text-sm">{sinNada ? t("emptyAll") : t("empty")}</p>
        </div>
      ) : params.view === "grid" ? (
        <InventoryGrid rows={rows} photos={photos} />
      ) : (
        <InventoryTable rows={rows} canSeeCosts={canSeeCosts} />
      )}

      <InventoryPagination page={page.page} pageCount={page.pageCount} />
    </div>
  );
}
