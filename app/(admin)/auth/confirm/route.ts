import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validations/auth";

/**
 * Alternativa al callback: si el correo se personaliza con `{{ .TokenHash }}` en vez
 * del `ConfirmationURL` por defecto, el enlace cae aquí. Se dejan las dos rutas para
 * que cambiar la plantilla más adelante no rompa el acceso.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=missing_token", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=verify_failed", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
