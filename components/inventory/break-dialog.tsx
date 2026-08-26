"use client";

import { useTranslations } from "next-intl";
import { Loader2, PackageOpen } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { openBreak } from "@/app/(admin)/admin/inventory/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { splitBreakCost } from "@/lib/domain/breaks";
import { formatMoney } from "@/lib/domain/money";

type Carta = { name: string; weight: string };

/**
 * Abrir una caja.
 *
 * La previsualización del reparto se calcula aquí con la MISMA función pura que
 * usa el servidor, así que el dueño ve en vivo lo que va a quedar escrito. Pero
 * los números que se envían son solo los nombres y los pesos: el costo lo
 * recalcula el servidor. Lo de esta pantalla es pintura.
 */
export function BreakDialog({
  itemId,
  boxCost,
}: {
  itemId: string;
  /** Ya formateado como string decimal, o null si el rol no lo ve. */
  boxCost: string | null;
}) {
  const t = useTranslations("admin.inventory.break");
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [weighted, setWeighted] = useState(false);
  const [revenue, setRevenue] = useState("");
  const [cartas, setCartas] = useState<Carta[]>([
    { name: "", weight: "1" },
    { name: "", weight: "1" },
  ]);

  const reparto = useMemo(() => {
    if (boxCost === null) return null;
    try {
      return splitBreakCost(
        boxCost,
        cartas.map((c, i) => ({
          id: String(i),
          childNumber: i + 1,
          ...(weighted ? { weight: c.weight || "1" } : {}),
        })),
      );
    } catch {
      return null;
    }
  }, [boxCost, cartas, weighted]);

  function cambiarCantidad(n: number) {
    const cantidad = Math.max(1, Math.min(200, n));
    setCartas((actual) => {
      if (cantidad <= actual.length) return actual.slice(0, cantidad);
      return [
        ...actual,
        ...Array.from({ length: cantidad - actual.length }, () => ({ name: "", weight: "1" })),
      ];
    });
  }

  function enviar() {
    startTransition(async () => {
      const result = await openBreak({
        sourceItemId: itemId,
        weighted,
        revenueFromSpots: revenue.trim() || undefined,
        children: cartas.map((c) => ({
          name: c.name.trim(),
          ...(weighted ? { weight: c.weight || "1" } : {}),
        })),
      });

      if (!result.ok) {
        toast.error(
          t.has(`errors.${result.reason}`) ? t(`errors.${result.reason}`) : t("errors.FAILED"),
        );
        return;
      }

      toast.success(
        result.costAllocated ? t("opened", { count: result.children }) : t("costPending"),
      );
      setAbierto(false);
    });
  }

  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger className="border-border hover:bg-accent inline-flex h-9 w-full items-center justify-center gap-2 rounded border px-3 text-sm font-medium transition-colors sm:w-auto">
        <PackageOpen className="size-4" aria-hidden />
        {t("open")}
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          <p className="text-muted-foreground text-sm">{t("intro")}</p>

          {boxCost === null && (
            <p className="border-border text-muted-foreground rounded border border-dashed p-3 text-sm">
              {t("noCost")}
            </p>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="break-cantidad">{t("cardCount")}</Label>
              <Input
                id="break-cantidad"
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                value={cartas.length}
                onChange={(e) => cambiarCantidad(Number(e.currentTarget.value) || 1)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="break-revenue">{t("revenue")}</Label>
              <Input
                id="break-revenue"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={revenue}
                onChange={(e) => setRevenue(e.currentTarget.value)}
              />
              <p className="text-muted-foreground text-xs">{t("revenueHelp")}</p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="break-weighted"
              checked={weighted}
              onCheckedChange={(v) => setWeighted(v === true)}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="break-weighted">{t("weighted")}</Label>
              <p className="text-muted-foreground text-xs">{t("weightedHelp")}</p>
            </div>
          </div>

          <ul className="space-y-2">
            {cartas.map((carta, index) => (
              <li key={index} className="flex items-end gap-2">
                <div className="grid flex-1 gap-1.5">
                  <Label htmlFor={`carta-${index}`} className="text-xs">
                    {t("cardName", { n: index + 1 })}
                  </Label>
                  <Input
                    id={`carta-${index}`}
                    value={carta.name}
                    onChange={(e) => {
                      const valor = e.currentTarget.value;
                      setCartas((a) => a.map((c, i) => (i === index ? { ...c, name: valor } : c)));
                    }}
                  />
                </div>

                {weighted && (
                  <div className="grid w-20 gap-1.5">
                    <Label htmlFor={`peso-${index}`} className="text-xs">
                      {t("weight")}
                    </Label>
                    <Input
                      id={`peso-${index}`}
                      type="text"
                      inputMode="decimal"
                      value={carta.weight}
                      onChange={(e) => {
                        const valor = e.currentTarget.value;
                        setCartas((a) =>
                          a.map((c, i) => (i === index ? { ...c, weight: valor } : c)),
                        );
                      }}
                    />
                  </div>
                )}

                {reparto && (
                  <span className="text-muted-foreground w-24 pb-2 text-right text-xs tabular-nums">
                    {formatMoney(reparto.children[index]?.allocatedCost ?? "0")}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {reparto && (
            <dl className="border-border space-y-1 rounded border p-3 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("boxCost")}</dt>
                <dd className="tabular-nums">{formatMoney(reparto.boxCost)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("sum")}</dt>
                <dd className="tabular-nums">
                  {formatMoney(
                    reparto.children.reduce(
                      (acc, c) => acc.plus(c.allocatedCost),
                      reparto.boxCost.minus(reparto.boxCost),
                    ),
                  )}
                </dd>
              </div>
              <p className="text-positive pt-1 text-xs">{t("balanced")}</p>
            </dl>
          )}

          <Button type="button" onClick={enviar} disabled={isPending} className="w-full">
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isPending ? t("opening") : t("confirm")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
