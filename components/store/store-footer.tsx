import { getTranslations } from "next-intl/server";

export async function StoreFooter() {
  const t = await getTranslations();
  const year = new Date().getFullYear();

  return (
    <footer className="border-border border-t">
      <div className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-8 text-xs">
        © {year} {t("common.brand")}. {t("store.footer.rights")}
      </div>
    </footer>
  );
}
