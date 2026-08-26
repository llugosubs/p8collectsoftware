import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/domain/money";
import { daysAwaitingDelivery } from "@/lib/domain/purchases";
import { formatDateOnly } from "@/lib/inventory/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.purchases");
  return { title: t("title") };
}

/** `acquisitions` es admin-only por RLS: la ruta lo dice antes de consultar. */
const ROLES_CON_ACCESO = new Set(["owner", "admin"]);

/** A partir de aquí, un lote pagado que no llega deja de ser normal. */
const DIAS_PARA_ALERTA = 14;

export default async function PurchasesPage() {
  const t = await getTranslations("admin.purchases");

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

  const { data: lotes } = await supabase
    .from("acquisitions")
    .select(
      "id, platform, reference, purchased_at, currency, total_cost, payment_status, received_status",
    )
    .is("deleted_at", null)
    .order("purchased_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(200);

  // Cuántas piezas trae cada lote. Se pide aparte para no depender de que
  // PostgREST resuelva el conteo dentro del embed.
  const conteos = new Map<string, number>();
  if (lotes?.length) {
    const { data: lineas } = await supabase
      .from("acquisition_lines")
      .select("acquisition_id")
      .in(
        "acquisition_id",
        lotes.map((l) => l.id),
      );
    for (const linea of lineas ?? []) {
      conteos.set(linea.acquisition_id, (conteos.get(linea.acquisition_id) ?? 0) + 1);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("description")}</p>
        </div>
        <Link
          href="/admin/purchases/new"
          className="bg-foreground text-background inline-flex h-9 items-center gap-2 rounded px-4 text-sm font-medium transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden />
          {t("new")}
        </Link>
      </header>

      {!lotes || lotes.length === 0 ? (
        <div className="border-border rounded border border-dashed py-16 text-center">
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
          <p className="text-muted-foreground mt-1 text-xs">{t("emptyHint")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {lotes.map((lote) => {
            const dias = daysAwaitingDelivery({
              purchasedAt: lote.purchased_at,
              paymentStatus: lote.payment_status,
              receivedStatus: lote.received_status,
            });
            const alerta = dias !== null && dias >= DIAS_PARA_ALERTA;

            return (
              <li key={lote.id}>
                <Link
                  href={`/admin/purchases/${lote.id}`}
                  className="border-border hover:border-foreground block rounded border p-3 transition-colors"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {t(`platformName.${lote.platform}`)}
                      {lote.reference && (
                        <span className="text-muted-foreground ml-2 font-mono text-xs">
                          {lote.reference}
                        </span>
                      )}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(String(lote.total_cost))}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground tabular-nums">
                      {formatDateOnly(lote.purchased_at)}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      {conteos.get(lote.id) ?? 0} {t("items").toLowerCase()}
                    </span>

                    <Badge
                      variant={lote.payment_status === "paid" ? "secondary" : "outline"}
                      className="font-normal"
                    >
                      {t(`payment.${lote.payment_status}`)}
                    </Badge>

                    <Badge
                      variant={lote.received_status === "received" ? "secondary" : "outline"}
                      className="font-normal"
                    >
                      {t(`received.${lote.received_status}`)}
                    </Badge>

                    {dias !== null && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 tabular-nums",
                          alerta ? "text-negative" : "text-muted-foreground",
                        )}
                      >
                        {alerta && <AlertTriangle className="size-3" aria-hidden />}
                        {t("awaiting", { days: dias })}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
