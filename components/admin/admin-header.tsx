import { getTranslations } from "next-intl/server";
import { LogOut } from "lucide-react";

import { signOut } from "@/app/(admin)/admin/actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/lib/supabase/types";

function initials(source: string): string {
  const parts = source.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part.charAt(0)).join("");
  return (letters || source.charAt(0)).toUpperCase();
}

export async function AdminHeader({
  email,
  displayName,
  role,
}: {
  email: string;
  displayName: string | null;
  role: UserRole;
}) {
  const t = await getTranslations("common");
  const label = displayName ?? email;

  return (
    <header className="border-border bg-background sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b px-4">
      <span className="md:hidden">
        <BrandMark height={18} />
      </span>
      <div className="ml-auto flex items-center gap-3">
        <Badge variant="secondary" className="hidden sm:inline-flex">
          {role}
        </Badge>
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initials(label)}</AvatarFallback>
        </Avatar>
        <span className="text-muted-foreground hidden max-w-[16ch] truncate text-sm sm:inline">
          {label}
        </span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" aria-label={t("signOut")}>
            <LogOut className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">{t("signOut")}</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
