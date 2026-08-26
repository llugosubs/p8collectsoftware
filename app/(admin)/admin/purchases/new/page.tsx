import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { PurchaseWizard } from "@/components/purchases/purchase-wizard";
import { createClient } from "@/lib/supabase/server";

import { getCardFeePercent } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.purchases.wizard");
  return { title: t("title") };
}

/** Compras es admin-only por RLS. La ruta lo dice antes, no después. */
const ROLES_CON_ACCESO = new Set(["owner", "admin"]);

export default async function NewPurchasePage() {
  const t = await getTranslations("admin.purchases.wizard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!ROLES_CON_ACCESO.has(profile?.role ?? "")) redirect("/forbidden");

  const cardFeePercent = await getCardFeePercent();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <Link
        href="/admin/purchases"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("title")}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <PurchaseWizard cardFeePercent={cardFeePercent} />
    </div>
  );
}
