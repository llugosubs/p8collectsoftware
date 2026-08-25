import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";

import { PrintButton } from "@/components/inventory/print-button";
import { formatGrade, itemTitle } from "@/lib/inventory/format";
import { parseInventoryParams } from "@/lib/inventory/params";
import { fetchInventoryForExport } from "@/lib/inventory/query";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Etiquetas" };

const ROLES_CON_COSTOS = new Set(["owner", "admin"]);
/** Un pliego adhesivo típico. Más que esto es una impresión que nadie revisa. */
const MAX_ETIQUETAS = 200;

/**
 * Etiquetas imprimibles con QR al SKU.
 *
 * El QR se genera en el servidor como SVG: no hay que mandar una librería al
 * navegador, y un SVG imprime nítido a cualquier tamaño, que es justo lo que un
 * QR necesita para que la cámara lo lea desde una etiqueta de 3 cm.
 */
export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin.inventory.labels");
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
  if (!profile || profile.role === "consignor") redirect("/forbidden");

  const { rows } = await fetchInventoryForExport(supabase, params, {
    canSeeCosts: ROLES_CON_COSTOS.has(profile.role),
  });

  const etiquetas = await Promise.all(
    rows.slice(0, MAX_ETIQUETAS).map(async (item) => ({
      sku: item.sku,
      titulo: itemTitle(item),
      grado: formatGrade(item.grading_company, item.grade, item.raw_condition),
      qr: await QRCode.toString(item.sku, {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
      }),
    })),
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("hint")}</p>
        </div>
        <PrintButton label={t("print")} />
      </div>

      {etiquetas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4 print:gap-1">
          {etiquetas.map((etiqueta) => (
            <div
              key={etiqueta.sku}
              className="border-border flex items-center gap-2 rounded border p-2 print:break-inside-avoid print:rounded-none"
            >
              <div
                className="size-14 shrink-0 [&>svg]:size-full"
                aria-hidden
                dangerouslySetInnerHTML={{ __html: etiqueta.qr }}
              />
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-medium">{etiqueta.sku}</p>
                <p className="text-muted-foreground truncate text-[10px]" title={etiqueta.titulo}>
                  {etiqueta.titulo}
                </p>
                <p className="text-muted-foreground text-[10px]">{etiqueta.grado}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
