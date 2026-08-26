"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Badge de estado de inventario.
 *
 * La guía de marca lo define preciso: badge OUTLINE, texto en MAYÚSCULAS, y un
 * color por estado. Antes todos los estados salían con el mismo relleno gris,
 * así que "en stock" y "vendido" se veían idénticos — que es justo lo que un
 * badge de estado no puede permitirse.
 *
 * El mapa vive aquí y solo aquí: la tabla, las tarjetas y la ficha lo comparten.
 *
 * La guía nombra un estado `auction` en rojo que el esquema todavía no tiene.
 * Cuando exista, se agrega una línea a este mapa y aparece en las tres.
 */

const COLOR_POR_ESTADO: Record<string, string> = {
  // Disponible para vender: es lo que importa, y va en dorado.
  in_stock: "text-accent-text border-accent-text/40",
  listed: "text-accent-text border-accent-text/40",

  reserved: "text-warning border-warning/40",
  sold: "text-neutral border-neutral/40",
  consigned_out: "text-consigned border-consigned/40",

  // En camino: todavía no es existencia, pero tampoco es una alerta.
  incoming: "text-muted-foreground border-border",

  returned: "text-warning border-warning/40",
  lost: "text-negative border-negative/40",
  consumed: "text-neutral border-neutral/40",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useTranslations("admin.inventory.status");

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-semibold tracking-[0.12em] uppercase",
        COLOR_POR_ESTADO[status] ?? "text-muted-foreground border-border",
        className,
      )}
    >
      {t.has(status) ? t(status) : status}
    </Badge>
  );
}

/** El dueño de la pieza, cuando es de un tercero. */
export function OwnerBadge({ ownerType }: { ownerType: string }) {
  const t = useTranslations("admin.inventory.owner");

  if (ownerType !== "consignment") return null;

  return (
    <Badge
      variant="outline"
      className="text-consigned border-consigned/40 text-[10px] font-semibold tracking-[0.12em] uppercase"
    >
      {t("consignment")}
    </Badge>
  );
}
