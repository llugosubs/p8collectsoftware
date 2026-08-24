import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const intlMiddleware = createIntlMiddleware(routing);

/** Rutas que no llevan segmento de idioma: el panel y todo el flujo de acceso. */
function isSingleLocaleArea(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/login" ||
    pathname.startsWith("/auth/")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const singleLocale = isSingleLocaleArea(pathname);

  // La tienda pasa por next-intl (redirige y reescribe según el idioma).
  // El panel no: siempre español, sin prefijo.
  const response = singleLocale ? NextResponse.next({ request }) : intlMiddleware(request);

  const user = await updateSession(request, response);

  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminArea && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Todo menos la API, los assets de Next y los archivos con extensión.
    "/((?!api|_next/static|_next/image|.*\\..*).*)",
  ],
};
