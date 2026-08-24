import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { signOut } from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sin acceso" };

export default async function ForbiddenPage() {
  const t = await getTranslations("forbidden");
  const tCommon = await getTranslations("common");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground mt-3">{t("body")}</p>

        {user?.email && (
          <p className="text-muted-foreground mt-6 text-sm">
            {t("signedInAs", { email: user.email })}
          </p>
        )}

        <form action={signOut} className="mt-6">
          <Button type="submit" variant="outline">
            {tCommon("signOut")}
          </Button>
        </form>
      </div>
    </div>
  );
}
