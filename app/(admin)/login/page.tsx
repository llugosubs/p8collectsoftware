import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { isGoogleAuthEnabled } from "@/lib/env";
import { safeNextPath } from "@/lib/validations/auth";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const t = await getTranslations("auth");

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <BrandMark height={22} />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{t("subtitle")}</p>

        <div className="mt-8">
          <LoginForm
            next={safeNextPath(next)}
            googleEnabled={isGoogleAuthEnabled()}
            initialError={error ? t("callbackFailed") : undefined}
          />
        </div>
      </div>
    </div>
  );
}
