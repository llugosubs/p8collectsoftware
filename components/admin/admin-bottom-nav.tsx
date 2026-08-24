"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PRIMARY_NAV, SECONDARY_NAV, isNavItemActive } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

/**
 * Barra inferior del panel en móvil: cuatro destinos fijos y "Más" para el resto.
 * Se usa con una sola mano, por eso vive abajo y respeta el safe area del iPhone.
 */
export function AdminBottomNav() {
  const pathname = usePathname();
  const t = useTranslations("admin.nav");
  const [open, setOpen] = useState(false);

  const secondaryActive = SECONDARY_NAV.some((item) => isNavItemActive(item.href, pathname));

  return (
    <nav className="border-border bg-background fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid grid-cols-5">
        {PRIMARY_NAV.map((item) => {
          const active = isNavItemActive(item.href, pathname);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px]",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className={cn("size-5", active && "stroke-[2.25]")} aria-hidden />
                {t(item.key)}
              </Link>
            </li>
          );
        })}
        <li>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              className={cn(
                "flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px]",
                secondaryActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <MoreHorizontal className="size-5" aria-hidden />
              {t("more")}
            </SheetTrigger>
            <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
              <SheetHeader>
                <SheetTitle>{t("more")}</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-2 px-4 pb-6">
                {SECONDARY_NAV.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="border-border flex flex-col items-center gap-2 rounded border px-2 py-4 text-center text-xs"
                    >
                      <Icon className="size-5" aria-hidden />
                      {t(item.key)}
                    </Link>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
