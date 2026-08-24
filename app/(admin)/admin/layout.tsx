import { redirect } from "next/navigation";

import { AdminBottomNav } from "@/components/admin/admin-bottom-nav";
import { AdminHeader } from "@/components/admin/admin-header";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { createClient } from "@/lib/supabase/server";

/**
 * El middleware solo garantiza que hay sesión. La autorización se decide aquí,
 * contra la base de datos: `consignor` tiene su propio portal (Fase 6) y no entra
 * al panel; quien no tenga perfil todavía, tampoco.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile || profile.role === "consignor") redirect("/forbidden");

  return (
    <div className="flex min-h-dvh">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader
          email={user.email ?? ""}
          displayName={profile.display_name}
          role={profile.role}
        />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
        <AdminBottomNav />
      </div>
    </div>
  );
}
