import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { ReceivedControl } from "@/components/purchases/received-control";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/domain/money";
import { lotPerformance } from "@/lib/domain/purchases";
import { formatDateOnly, formatGrade, itemTitle } from "@/lib/inventory/format";
import { readNullableNumeric } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Lote" };

const ROLES_CON_ACCESO = new Set(["owner", "admin"]);

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("admin.purchases");
  const td = await getTranslations("admin.purchases.detail");
  const tInv = await getTranslations("admin.inventory");

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

  const { data: lote } = await supabase
    .from("acquisitions")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!lote) notFound();

  const { data: piezas } = await supabase
    .from("items_with_costs")
    .select(
      "id, sku, player_or_character, set_name, year, card_number, variant, grading_company, grade, raw_condition, status, market_value, cost_basis",
    )
    .eq("acquisition_id", id)
    .order("sku", { ascending: true });

  // Lo realizado sale de las líneas de orden de las piezas del lote. En la
  // Fase 2 todavía no hay ventas, así que es cero — pero la consulta ya está,
  // y el día que existan no hay que tocar esta pantalla.
  const idsPiezas = (piezas ?? []).map((p) => p.id).filter((x): x is string => x !== null);
  let realizado = "0";
  if (idsPiezas.length > 0) {
    const { data: lineas } = await supabase
      .from("order_lines")
      .select("unit_price, quantity")
      .in("item_id", idsPiezas);
    realizado = String(
      (lineas ?? []).reduce((acc, l) => acc + Number(l.unit_price) * l.quantity, 0),
    );
  }

  // Solo lo que NO se ha vendido cuenta como "mercado de lo que queda".
  const rendimiento = lotPerformance({
    totalCost: String(lote.total_cost),
    realized: realizado,
    marketValues: (piezas ?? [])
      .filter((p) => p.status !== "sold")
      .map((p) => readNullableNumeric(p.market_value)),
  });

  const costos: readonly (readonly [string, number])[] = [
    ["hammer", Number(lote.hammer_total)],
    ["premium", Number(lote.buyer_premium)],
    ["cardFee", Number(lote.card_fee)],
    ["shipping", Number(lote.shipping_intl)],
    ["courier", Number(lote.courier_ve)],
    ["customs", Number(lote.customs_ve)],
    ["other", Number(lote.other_costs)],
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
      <Link
        href="/admin/purchases"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {td("back")}
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(`platformName.${lote.platform}`)}
          {lote.reference && (
            <span className="text-muted-foreground ml-2 font-mono text-base">{lote.reference}</span>
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground tabular-nums">
            {formatDateOnly(lote.purchased_at)}
          </span>
          <Badge variant="outline" className="font-normal">
            {t(`payment.${lote.payment_status}`)}
          </Badge>
          <Badge variant="outline" className="font-normal">
            {t(`received.${lote.received_status}`)}
          </Badge>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="py-4">
            <h2 className="mb-3 text-sm font-medium">{td("costs")}</h2>
            <dl className="space-y-1 text-sm">
              {costos
                .filter(([, valor]) => valor !== 0)
                .map(([clave, valor]) => (
                  <div key={clave} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{td(clave)}</dt>
                    <dd className="tabular-nums">{formatMoney(String(valor))}</dd>
                  </div>
                ))}
              <div className="border-border flex justify-between gap-2 border-t pt-1.5 font-medium">
                <dt>{td("total")}</dt>
                <dd className="tabular-nums">{formatMoney(String(lote.total_cost))}</dd>
              </div>
            </dl>

            {lote.local_fx_rate && (
              <p className="text-muted-foreground mt-3 text-xs">
                {/* Los bolívares pasan por formatMoney como cualquier otro
                    monto: sin decimales y con el símbolo delante. */}
                <span className="tabular-nums">Bs/USD {String(lote.local_fx_rate)}</span>
                {lote.courier_ve_ves && (
                  <>
                    {" · "}
                    {td("courier")}{" "}
                    <span className="tabular-nums">
                      {formatMoney(String(lote.courier_ve_ves), "VES")}
                    </span>
                  </>
                )}
                {lote.customs_ve_ves && (
                  <>
                    {" · "}
                    {td("customs")}{" "}
                    <span className="tabular-nums">
                      {formatMoney(String(lote.customs_ve_ves), "VES")}
                    </span>
                  </>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <h2 className="mb-1 text-sm font-medium">{td("performance")}</h2>
            <p className="text-muted-foreground mb-3 text-xs">{td("netHelp")}</p>

            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{td("total")}</dt>
                <dd className="tabular-nums">{formatMoney(rendimiento.totalCost)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{td("realized")}</dt>
                <dd className="tabular-nums">{formatMoney(rendimiento.realized)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{td("remaining")}</dt>
                <dd className="tabular-nums">
                  {rendimiento.marketOfRemaining === null ? (
                    <span className="text-muted-foreground text-xs italic">{tInv("noComp")}</span>
                  ) : (
                    formatMoney(rendimiento.marketOfRemaining)
                  )}
                </dd>
              </div>
              <div className="border-border flex justify-between gap-2 border-t pt-1.5 font-medium">
                <dt>{td("net")}</dt>
                <dd
                  className={cn(
                    "tabular-nums",
                    rendimiento.netPosition?.isPositive() && "text-positive",
                    rendimiento.netPosition?.isNegative() && "text-negative",
                  )}
                >
                  {rendimiento.netPosition === null ? (
                    <span className="text-muted-foreground text-xs font-normal italic">—</span>
                  ) : (
                    formatMoney(rendimiento.netPosition)
                  )}
                </dd>
              </div>
            </dl>

            {rendimiento.marketOfRemaining === null ? (
              <p className="text-muted-foreground mt-3 text-xs">{td("noMarket")}</p>
            ) : (
              rendimiento.itemsWithoutMarket > 0 && (
                <p className="text-muted-foreground mt-3 text-xs">
                  {td("someWithoutMarket", { count: rendimiento.itemsWithoutMarket })}
                </p>
              )
            )}

            <div className="mt-4">
              <ReceivedControl acquisitionId={id} receivedStatus={lote.received_status} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="py-4">
          <h2 className="mb-3 text-sm font-medium">
            {td("pieces")} ({piezas?.length ?? 0})
          </h2>
          <ul className="divide-border divide-y">
            {(piezas ?? []).map((pieza) => (
              <li key={pieza.id} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
                <Link
                  href={`/admin/inventory/${pieza.id}`}
                  className="text-muted-foreground hover:text-foreground font-mono text-xs hover:underline"
                >
                  {pieza.sku}
                </Link>
                <span className="min-w-0 flex-1 truncate">{itemTitle(pieza)}</span>
                <span className="text-muted-foreground text-xs">
                  {formatGrade(pieza.grading_company, pieza.grade, pieza.raw_condition)}
                </span>
                <span className="w-20 text-right tabular-nums">
                  {formatMoney(String(pieza.cost_basis ?? 0))}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
