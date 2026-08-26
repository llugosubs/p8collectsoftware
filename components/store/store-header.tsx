import { getTranslations } from "next-intl/server";

import { BrandMark } from "@/components/brand/brand-mark";
import { Link } from "@/i18n/navigation";

import { LocaleSwitcher } from "./locale-switcher";

export async function StoreHeader() {
  const t = await getTranslations("common");

  return (
    <header className="border-border border-b">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        {/* El lockup como imagen, nunca como texto: "Collects" es parte del
            logo y no se re-tipografía. */}
        <Link href="/" aria-label={t("brand")}>
          <BrandMark height={22} />
        </Link>
        <LocaleSwitcher />
      </div>
    </header>
  );
}
