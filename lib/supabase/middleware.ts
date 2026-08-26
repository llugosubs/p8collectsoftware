import type { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import * as Sentry from "@sentry/nextjs";
import type { User } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";

import type { Database } from "./database.types";

export type SessionCheck = {
  user: User | null;
  /** La respuesta a devolver. Puede NO ser la que entró: ver abajo. */
  response: NextResponse;
};

/**
 * Refresca el token de sesión.
 *
 * El detalle que parece un tecnicismo y no lo es: cuando Supabase rota el
 * token a mitad de la petición, no basta con escribir las cookies nuevas en la
 * respuesta. La página que se renderiza después lee las cookies del REQUEST, y
 * ese request se congela en el momento en que se construye `NextResponse.next(
 * { request } )`. Si la respuesta se creó antes del refresco, el render de
 * abajo sigue viendo las cookies viejas.
 *
 * El síntoma es feo y difícil de atribuir: entras con tu enlace mágico y la
 * primera pantalla te dice "sin acceso", porque la consulta a `profiles` sale
 * sin sesión válida y el RLS devuelve cero filas. Recargas y funciona.
 *
 * Por eso la respuesta se RECONSTRUYE dentro de `setAll`, después de mutar las
 * cookies del request. `buildResponse` es una función y no un objeto justo
 * para poder rehacerla.
 *
 * Esta función solo resuelve *autenticación*: quién eres. La *autorización* —
 * qué rol tienes — se decide más abajo, contra la base y con RLS de por medio.
 */
export async function updateSession(
  request: NextRequest,
  buildResponse: () => NextResponse,
): Promise<SessionCheck> {
  const env = getPublicEnv();
  let response = buildResponse();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          // Rehecha con el request ya actualizado: así el render de abajo ve
          // las cookies nuevas y no las que acaban de quedar obsoletas.
          response = buildResponse();

          for (const { name, value, options } of cookiesToSet) {
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

    return { user, response };
  } catch (error) {
    // Si Supabase no responde, la tienda pública tiene que seguir sirviéndose.
    // Sin usuario, el panel manda a login — que es lo correcto cuando no se
    // puede verificar quién eres.
    Sentry.captureException(error);
    return { user: null, response };
  }
}
