import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function StoreHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("store.home");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-24">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        {t("title")}
      </h1>
      <p className="text-muted-foreground mt-4 max-w-xl text-lg">{t("subtitle")}</p>
      <p className="text-muted-foreground mt-12 text-sm tracking-wide uppercase">
        {t("comingSoon")}
      </p>
    </div>
  );
}
