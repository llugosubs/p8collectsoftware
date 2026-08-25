"use client";

import { useTranslations } from "next-intl";
import { Store, StoreIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { setItemPublished } from "@/app/(admin)/admin/inventory/actions";
import { Button } from "@/components/ui/button";

/**
 * El botón dice por qué no se puede publicar, en vez de quedarse gris sin
 * explicación. La razón la decide el servidor: la interfaz solo la traduce.
 */
export function PublishButton({
  itemId,
  isPublished,
  blockedReason,
}: {
  itemId: string;
  isPublished: boolean;
  blockedReason: string | null;
}) {
  const t = useTranslations("admin.inventory.detail");
  const [isPending, startTransition] = useTransition();

  function alternar() {
    startTransition(async () => {
      const result = await setItemPublished({ itemId, publish: !isPublished });
      if (result.ok) {
        toast.success(result.published ? t("publishedOk") : t("unpublishedOk"));
        return;
      }
      const clave = `blocked.${result.reason}`;
      const traducida = t.has(clave) ? t(clave) : t("publishFailed");
      toast.error(traducida);
    });
  }

  const bloqueado = !isPublished && blockedReason !== null;

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant={isPublished ? "outline" : "default"}
        onClick={alternar}
        disabled={isPending || bloqueado}
        className="w-full sm:w-auto"
      >
        {isPublished ? (
          <StoreIcon className="size-4" aria-hidden />
        ) : (
          <Store className="size-4" aria-hidden />
        )}
        {isPublished ? t("unpublish") : t("publish")}
      </Button>

      {bloqueado && (
        <p className="text-muted-foreground text-xs">
          <span className="font-medium">{t("cannotPublish")}:</span>{" "}
          {t.has(`blocked.${blockedReason}`) ? t(`blocked.${blockedReason}`) : blockedReason}
        </p>
      )}
    </div>
  );
}
