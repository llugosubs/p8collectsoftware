import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const t = await getTranslations("admin.settings");

  return <ModulePlaceholder title={t("title")} description={t("description")} phase="Fase 3" />;
}
