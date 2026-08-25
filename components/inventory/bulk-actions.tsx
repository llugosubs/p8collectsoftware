"use client";

import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { bulkUpdateItems } from "@/app/(admin)/admin/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ITEM_STATUSES } from "@/lib/inventory/params";

/** Los mismos que acepta el servidor. `sold` y `consumed` se ganan, no se ponen. */
const ESTADOS_MANUALES = ITEM_STATUSES.filter(
  (s) => !["sold", "consumed", "consigned_out"].includes(s),
);

/**
 * Barra de acciones masivas.
 *
 * Aparece pegada abajo cuando hay algo seleccionado, por encima del bottom nav
 * en móvil. No incluye "publicar": publicar exige condiciones por pieza —foto,
 * precio, mínimo del consignante— y un botón que publica quince cartas de las
 * que ocho fallan en silencio es peor que no tenerlo.
 */
export function BulkActions({
  selected,
  onDone,
  onClear,
}: {
  selected: readonly string[];
  onDone: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("admin.inventory.bulk");
  const tStatus = useTranslations("admin.inventory.status");
  const [isPending, startTransition] = useTransition();
  const [ubicacion, setUbicacion] = useState("");

  if (selected.length === 0) return null;

  function aplicar(cambios: Record<string, unknown>) {
    startTransition(async () => {
      const result = await bulkUpdateItems({ itemIds: selected, ...cambios });
      if (!result.ok) {
        toast.error(t("failed"));
        return;
      }
      toast.success(t("done", { count: result.updated }));
      onDone();
    });
  }

  return (
    <div className="border-border bg-background sticky bottom-16 z-30 -mx-4 border-t px-4 py-3 md:bottom-0 md:mx-0 md:rounded md:border">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium tabular-nums">
          {t("selected", { count: selected.length })}
        </span>

        <Button variant="ghost" size="sm" onClick={onClear} disabled={isPending}>
          <X className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">{t("clear")}</span>
        </Button>

        <span className="bg-border hidden h-5 w-px sm:block" />

        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => aplicar({ markReceived: true })}
        >
          {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("markReceived")}
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => aplicar({ unpublish: true })}
        >
          {t("unpublish")}
        </Button>

        <div className="flex items-center gap-1">
          <Input
            value={ubicacion}
            onChange={(e) => setUbicacion(e.currentTarget.value)}
            placeholder={t("locationPlaceholder")}
            aria-label={t("setLocation")}
            className="h-9 w-44"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || ubicacion.trim() === ""}
            onClick={() => aplicar({ location: ubicacion.trim() })}
          >
            {t("apply")}
          </Button>
        </div>

        <select
          className="border-border bg-background h-9 rounded border px-2 text-sm"
          aria-label={t("setStatus")}
          defaultValue=""
          disabled={isPending}
          onChange={(e) => {
            const valor = e.currentTarget.value;
            e.currentTarget.value = "";
            if (valor) aplicar({ status: valor });
          }}
        >
          <option value="">{t("setStatus")}</option>
          {ESTADOS_MANUALES.map((estado) => (
            <option key={estado} value={estado}>
              {tStatus(estado)}
            </option>
          ))}
        </select>
      </div>

      <p className="text-muted-foreground mt-2 text-xs">{t("publishNote")}</p>
    </div>
  );
}
