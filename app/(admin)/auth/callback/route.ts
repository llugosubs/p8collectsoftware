import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validations/auth";

/**
 * Retorno del enlace mágico y de Google (flujo PKCE): Supabase manda de vuelta un
 * `code` que aquí se cambia por una sesión. Sirve con las plantillas de correo por
 * defecto, sin tener que editarlas en el panel de Supabase.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/login?error=exchange_failed", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
