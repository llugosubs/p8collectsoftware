"use client";

import { useTranslations } from "next-intl";
import { Loader2, Undo2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { revertImportBatch } from "@/app/(admin)/admin/import/actions";
import { Button } from "@/components/ui/button";

/**
 * Deshacer un lote importado.
 *
 * Pide confirmación porque borra inventario, y cuando la base se niega muestra
 * su mensaje ENTERO: la función lista pieza por pieza qué lo impide, y esa
 * lista es justo lo que hay que leer para saber si se puede arreglar.
 *
 * Al deshacer se recarga la página entera, no se refresca. Un `router.refresh`
 * dejaría el wizard de arriba mostrando "Listo, las piezas ya están en el
 * inventario" justo encima del lote marcado como deshecho: dos afirmaciones
 * contrarias en la misma pantalla, y la falsa es la que está en grande.
 */
export function RevertButton({ batchId }: { batchId: string }) {
  const t = useTranslations("admin.import");
  const [pendiente, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);

  function revertir() {
    startTransition(async () => {
      const resultado = await revertImportBatch(batchId);
      setConfirmando(false);
      if (!resultado.ok) {
        toast.error(resultado.detail ?? t("errors.REVERT_BLOCKED"), { duration: 12_000 });
        return;
      }
      toast.success(t("reverted", { items: resultado.itemsDeleted }));
      window.location.reload();
    });
  }

  if (!confirmando) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(true)}>
        <Undo2 className="size-4" aria-hidden />
        {t("report.revert")}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" size="sm" variant="destructive" onClick={revertir} disabled={pendiente}>
        {pendiente && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t("confirmRevert")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(false)}>
        {t("cancel")}
      </Button>
    </div>
  );
}
