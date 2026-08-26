import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/domain/money";
import {
  unrealizedGain,
  type InventorySegment,
  type InventoryTotals,
} from "@/lib/domain/inventory";
import { cn } from "@/lib/utils";

/**
 * El valor del inventario, en cuatro líneas separadas.
 *
 * No se suman en una sola cifra a propósito. Las cajas abiertas ya trasladaron
 * su costo a las cartas que salieron, así que mezclarlas contaría el mismo
 * dinero dos veces; y lo consignado está aquí pero es de terceros, así que
 * sumarlo infla el patrimonio con plata ajena.
 */

const SEGMENTOS: readonly { key: InventorySegment; nota?: "consigned" | "consumed" }[] = [
  { key: "available" },
  { key: "incoming" },
  { key: "consigned", nota: "consigned" },
  { key: "consumed", nota: "consumed" },
];

export async function InventoryTotalsPanel({ totals }: { totals: InventoryTotals }) {
  const t = await getTranslations("admin.inventory.totals");

  const visibles = SEGMENTOS.filter(({ key }) => totals[key].items > 0);
  if (visibles.length === 0) return null;

  return (
    <section aria-label={t("title")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {visibles.map(({ key, nota }) => {
        const seg = totals[key];
        const gain = unrealizedGain(seg);
        const costoIncompleto = seg.itemsWithoutCost > 0;

        return (
          <Card key={key} className={cn(nota && "border-dashed")}>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{t(key)}</h3>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {seg.units === seg.items ? seg.items : `${seg.items} · ${seg.units} u.`}
                </span>
              </div>

              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t("atCost")}</dt>
                  <dd className="tabular-nums">
                    {costoIncompleto && seg.atCost.isZero() ? (
                      <span className="text-muted-foreground text-xs italic">—</span>
                    ) : (
                      formatMoney(seg.atCost)
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t("atMarket")}</dt>
                  <dd className="tabular-nums">{formatMoney(seg.atMarket)}</dd>
                </div>
                <div className="border-border flex justify-between gap-2 border-t pt-1">
                  <dt className="text-muted-foreground">{t("unrealized")}</dt>
                  <dd
                    className={cn(
                      "font-medium tabular-nums",
                      gain !== null && gain.isPositive() && "text-positive",
                      gain !== null && gain.isNegative() && "text-negative",
                    )}
                  >
                    {gain === null ? (
                      <span className="text-muted-foreground text-xs font-normal italic">—</span>
                    ) : (
                      formatMoney(gain)
                    )}
                  </dd>
                </div>
              </dl>

              {costoIncompleto && (
                <p className="text-muted-foreground text-xs">
                  {t("hiddenCosts", { count: seg.itemsWithoutCost })}
                </p>
              )}
              {nota && <p className="text-muted-foreground text-xs">{t(`${nota}Note`)}</p>}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
