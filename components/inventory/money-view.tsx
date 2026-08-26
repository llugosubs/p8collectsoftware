"use client";

import { useTranslations } from "next-intl";

import type { MoneyView } from "@/lib/inventory/format";
import { cn } from "@/lib/utils";

/**
 * Una cifra de dinero, o la razón por la que no está.
 *
 * Nunca imprime cero por un dato ausente: un costo que el RLS esconde y un
 * costo de cero son cosas distintas, y confundirlas cambia si una venta se ve
 * como ganancia o como pérdida.
 */
export function MoneyText({
  value,
  className,
  signed = false,
}: {
  value: MoneyView;
  className?: string;
  signed?: boolean;
}) {
  const t = useTranslations("admin.inventory");

  if ("missing" in value) {
    return (
      <span className={cn("text-muted-foreground text-xs italic", className)}>
        {value.missing === "hidden" ? t("noAccess") : t("noComp")}
      </span>
    );
  }

  // El verde y el rojo existen solo para ganancia y pérdida, nunca de adorno.
  const negativo = signed && value.text.includes("-");
  const positivo = signed && !negativo;

  return (
    <span
      className={cn(
        "tabular-nums",
        positivo && "text-positive",
        negativo && "text-negative",
        className,
      )}
    >
      {value.text}
    </span>
  );
}
