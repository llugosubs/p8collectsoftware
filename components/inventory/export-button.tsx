"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Download, QrCode } from "lucide-react";

export function ExportButton() {
  const t = useTranslations("admin.inventory");
  const searchParams = useSearchParams();

  // Se exporta lo que está viendo, con el mismo filtro. Un botón que ignora el
  // filtro y baja el inventario entero sorprende a cualquiera.
  const href = `/admin/inventory/export?${searchParams.toString()}`;

  return (
    <a
      href={href}
      download
      className="border-border hover:bg-accent inline-flex h-9 shrink-0 items-center gap-2 rounded border px-3 text-sm font-medium transition-colors"
    >
      <Download className="size-4" aria-hidden />
      <span className="hidden sm:inline">{t("export")}</span>
    </a>
  );
}

/** Las etiquetas se generan sobre el MISMO filtro que está viendo. */
export function LabelsLink() {
  const t = useTranslations("admin.inventory.labels");
  const searchParams = useSearchParams();

  return (
    <Link
      href={`/admin/inventory/labels?${searchParams.toString()}`}
      className="border-border hover:bg-accent inline-flex h-9 shrink-0 items-center gap-2 rounded border px-3 text-sm font-medium transition-colors"
    >
      <QrCode className="size-4" aria-hidden />
      <span className="hidden sm:inline">{t("openLabels")}</span>
    </Link>
  );
}
