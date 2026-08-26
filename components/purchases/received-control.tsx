"use client";

import { useTranslations } from "next-intl";
import { Loader2, PackageCheck, Truck } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { setAcquisitionReceived } from "@/app/(admin)/admin/purchases/actions";
import { Button } from "@/components/ui/button";

/**
 * Cambiar el estado de recepción del lote.
 *
 * Marcar recibido no es solo un cambio de etiqueta: mueve las piezas del lote
 * de 'en tránsito' a disponibles, con su fecha. El mensaje dice cuántas pasaron
 * a inventario, porque eso es lo que de verdad ocurrió.
 */
export function ReceivedControl({
  acquisitionId,
  receivedStatus,
}: {
  acquisitionId: string;
  receivedStatus: string;
}) {
  const t = useTranslations("admin.purchases.detail");
  const [isPending, startTransition] = useTransition();

  function cambiar(status: "in_transit" | "received") {
    startTransition(async () => {
      const result = await setAcquisitionReceived({ acquisitionId, status });
      if (!result.ok) {
        toast.error(t("receivedFailed"));
        return;
      }
      toast.success(t("receivedOk", { count: result.released }));
    });
  }

  if (receivedStatus === "received") return null;

  return (
    <div className="flex flex-wrap gap-2">
      {receivedStatus === "pending" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => cambiar("in_transit")}
        >
          <Truck className="size-4" aria-hidden />
          {t("markInTransit")}
        </Button>
      )}

      <Button type="button" size="sm" disabled={isPending} onClick={() => cambiar("received")}>
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <PackageCheck className="size-4" aria-hidden />
        )}
        {t("markReceived")}
      </Button>
    </div>
  );
}
