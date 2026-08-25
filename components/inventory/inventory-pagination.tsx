"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function InventoryPagination({ page, pageCount }: { page: number; pageCount: number }) {
  const t = useTranslations("admin.inventory");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pageCount <= 1) return null;

  function ir(destino: number) {
    const next = new URLSearchParams(searchParams.toString());
    if (destino <= 1) next.delete("page");
    else next.set("page", String(destino));
    router.replace(`${pathname}?${next.toString()}`, { scroll: true });
  }

  return (
    <nav
      className="flex items-center justify-between gap-2"
      aria-label={t("page", { page, pages: pageCount })}
    >
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => ir(page - 1)}>
        <ChevronLeft className="size-4" aria-hidden />
        {t("previous")}
      </Button>

      <span className="text-muted-foreground text-sm tabular-nums">
        {t("page", { page, pages: pageCount })}
      </span>

      <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => ir(page + 1)}>
        {t("next")}
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </nav>
  );
}
