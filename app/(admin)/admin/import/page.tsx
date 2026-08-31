import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ImportWizard } from "@/components/import/import-wizard";
import { RevertButton } from "@/components/import/revert-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateOnly } from "@/lib/inventory/format";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.import");
  return { title: t("title") };
}

/**
 * El importador crea compras, y `acquisitions` es de admin para arriba. Un
 * staff llegaría al último botón y rebotaría con un error de permisos después
 * de mapear 27 columnas: mejor decírselo en la puerta.
 */
const ROLES_CON_ACCESO = new Set(["owner", "admin"]);

/** Los días que dura la ventana de reversión, si nadie la cambió en ajustes. */
const VENTANA_POR_DEFECTO = 7;

export default async function ImportPage() {
  const t = await getTranslations("admin.import");

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

  if (!ROLES_CON_ACCESO.has(profile?.role ?? "")) redirect("/forbidden");

  const [{ data: lotes }, { data: ajuste }] = await Promise.all([
    supabase
      .from("import_batches")
      .select(
        "id, file_name, status, rows_created, rows_updated, rows_skipped, rows_error, committed_at, created_at",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("settings").select("value").eq("key", "import_revert_window_days").maybeSingle(),
  ]);

  const ventana = Number(ajuste?.value ?? VENTANA_POR_DEFECTO) || VENTANA_POR_DEFECTO;
  const limite = Date.now() - ventana * 86_400_000;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>

      <ImportWizard />

      {lotes !== null && lotes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t("history.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("history.hint", { days: ventana })}
          </p>

          <div className="space-y-2">
            {lotes.map((lote) => {
              const dentroDeVentana =
                lote.status === "committed" &&
                lote.committed_at !== null &&
                new Date(lote.committed_at).getTime() >= limite;

              return (
                <Card key={lote.id}>
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium">
                        {lote.file_name ?? t("history.noName")}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateOnly(lote.created_at.slice(0, 10))} ·{" "}
                        {t("history.counts", {
                          created: lote.rows_created,
                          updated: lote.rows_updated,
                          skipped: lote.rows_skipped,
                          errors: lote.rows_error,
                        })}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">{t(`batchStatus.${lote.status}`)}</Badge>
                      {dentroDeVentana && <RevertButton batchId={lote.id} />}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
