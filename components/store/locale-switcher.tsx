"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

const LABELS: Record<Locale, string> = { es: "ES", en: "EN" };

export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Idioma / Language">
      {routing.locales.map((option) => (
        <button
          key={option}
          type="button"
          disabled={isPending || option === locale}
          aria-current={option === locale ? "true" : undefined}
          onClick={() => {
            startTransition(() => {
              router.replace(pathname, { locale: option });
            });
          }}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium tracking-wide transition-colors",
            option === locale
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
