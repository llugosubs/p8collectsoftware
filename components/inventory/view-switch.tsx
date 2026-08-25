"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutGrid, List } from "lucide-react";

import { cn } from "@/lib/utils";

export function ViewSwitch() {
  const t = useTranslations("admin.inventory");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const actual = searchParams.get("view") === "grid" ? "grid" : "list";

  function cambiar(vista: "list" | "grid") {
    const next = new URLSearchParams(searchParams.toString());
    if (vista === "list") next.delete("view");
    else next.set("view", vista);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="border-border flex shrink-0 rounded border" role="group">
      {(
        [
          { key: "list", label: t("viewList"), Icon: List },
          { key: "grid", label: t("viewGrid"), Icon: LayoutGrid },
        ] as const
      ).map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={actual === key}
          aria-label={label}
          onClick={() => cambiar(key)}
          className={cn(
            "flex h-9 items-center gap-1.5 px-3 text-sm transition-colors first:rounded-l last:rounded-r",
            actual === key
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
