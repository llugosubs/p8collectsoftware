import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { LocaleSwitcher } from "./locale-switcher";

export async function StoreHeader() {
  const t = await getTranslations("common");

  return (
    <header className="border-border border-b">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        {/* Wordmark solo. El monograma P8 y el wordmark nunca van juntos. */}
        <Link href="/" className="text-sm font-semibold tracking-[0.2em] uppercase">
          {t("brand")}
        </Link>
        <LocaleSwitcher />
      </div>
    </header>
  );
}
