import {
  BarChart3,
  Bot,
  ClipboardList,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingBag,
  Tag,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = {
  /** Clave dentro de `admin.nav` en los archivos de mensajes. */
  key: string;
  href: string;
  icon: LucideIcon;
};

/** Los cuatro destinos del bottom nav móvil, más "Más" que abre el resto. */
export const PRIMARY_NAV: readonly AdminNavItem[] = [
  { key: "dashboard", href: "/admin", icon: LayoutDashboard },
  { key: "inventory", href: "/admin/inventory", icon: Package },
  { key: "sell", href: "/admin/sell", icon: Tag },
  { key: "purchases", href: "/admin/purchases", icon: ShoppingBag },
] as const;

export const SECONDARY_NAV: readonly AdminNavItem[] = [
  { key: "import", href: "/admin/import", icon: Upload },
  { key: "accounts", href: "/admin/accounts", icon: Wallet },
  { key: "receivables", href: "/admin/receivables", icon: ClipboardList },
  { key: "customers", href: "/admin/customers", icon: Users },
  { key: "reports", href: "/admin/reports", icon: BarChart3 },
  { key: "assistant", href: "/admin/assistant", icon: Bot },
  { key: "settings", href: "/admin/settings", icon: Settings },
] as const;

export const ALL_NAV: readonly AdminNavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

/** `/admin` solo coincide exacto; el resto también con sus subrutas. */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
