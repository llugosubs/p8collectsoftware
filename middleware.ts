import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Rutas que no llevan segmento de idioma: el panel y todo el flujo de acceso.
 *
 * `/forbidden` tiene que estar aquí. Sin él, next-intl lo reescribe a
 * `/en/forbidden`, que no existe, y quien no tiene permiso ve un 404 en vez de
 * la explicación de por qué no puede entrar.
 */
function isSingleLocaleArea(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/login" ||
    pathname === "/forbidden" ||
    pathname.startsWith("/auth/")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const singleLocale = isSingleLocaleArea(pathname);

  // La tienda pasa por next-intl (redirige y reescribe según el idioma).
  // El panel no: siempre español, sin prefijo.
  //
  // Se pasa una FUNCIÓN, no una respuesta ya hecha: si Supabase rota el token,
  // `updateSession` tiene que rehacer la respuesta con el request ya
  // actualizado. Si no, la página de abajo lee las cookies viejas y la primera
  // pantalla después de entrar dice "sin acceso".
  const construirRespuesta = () =>
    singleLocale ? NextResponse.next({ request }) : intlMiddleware(request);

  const { user, response } = await updateSession(request, construirRespuesta);

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
