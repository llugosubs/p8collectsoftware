"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { ALL_NAV, isNavItemActive } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

export function AdminSidebar() {
  const pathname = usePathname();
  const t = useTranslations("admin.nav");
  const tCommon = useTranslations("common");

  return (
    <aside className="border-border hidden w-56 shrink-0 border-r md:block">
      <div className="sticky top-0 flex h-dvh flex-col">
        <div className="flex h-16 items-center px-5">
          <span className="text-sm font-semibold tracking-[0.2em] uppercase">
            {tCommon("brand")}
          </span>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {ALL_NAV.map((item) => {
            const active = isNavItemActive(item.href, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {t(item.key)}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
