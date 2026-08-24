import type { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import * as Sentry from "@sentry/nextjs";
import type { User } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Refresca el token de sesión y escribe las cookies resultantes sobre la respuesta que
 * ya venía en camino (la de next-intl, por ejemplo), en vez de crear una nueva. Si se
 * crea otra, se pierden las cabeceras de reescritura de idioma.
 *
 * Devuelve el usuario autenticado, o null. Solo resuelve *autenticación*: quién es.
 * La *autorización* — qué rol tiene y si puede entrar al panel — se decide en el layout
 * del admin, contra la base de datos y con RLS de por medio.
 */
export async function updateSession(
  request: NextRequest,
  response: NextResponse,
): Promise<User | null> {
  const env = getPublicEnv();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return user;
  } catch (error) {
    // Si Supabase no responde, la tienda pública tiene que seguir sirviéndose.
    // Sin usuario, el panel manda a login — que es lo correcto cuando no se
    // puede verificar quién eres.
    Sentry.captureException(error);
    return null;
  }
}
