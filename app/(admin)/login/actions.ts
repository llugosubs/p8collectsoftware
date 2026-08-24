"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { magicLinkSchema, safeNextPath } from "@/lib/validations/auth";

export type LoginFormState =
  { status: "idle" } | { status: "sent"; email: string } | { status: "error"; message: string };

export async function sendMagicLink(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const t = await getTranslations("auth");

  const parsed = magicLinkSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: t("invalidEmail") };
  }

  const next = safeNextPath(formData.get("next")?.toString());
  const env = getPublicEnv();
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return { status: "error", message: t("sendFailed") };
  }

  return { status: "sent", email: parsed.data.email };
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next")?.toString());
  const env = getPublicEnv();
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth");
  }

  redirect(data.url);
}
