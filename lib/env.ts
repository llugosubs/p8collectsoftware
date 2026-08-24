import { z } from "zod";

/**
 * Las variables se validan de forma perezosa, no al importar el módulo: así el `build`
 * de CI no exige secretos reales y el fallo, cuando ocurre, dice exactamente qué falta.
 */

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("NEXT_PUBLIC_SUPABASE_URL debe ser una URL válida"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "Falta NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  NEXT_PUBLIC_SITE_URL: z.url("NEXT_PUBLIC_SITE_URL debe ser una URL válida"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cachedPublicEnv: PublicEnv | null = null;

export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;

  // Las referencias van escritas literalmente a propósito: Next solo sustituye
  // `process.env.NEXT_PUBLIC_*` cuando aparece así, no por acceso dinámico.
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => `  · ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Variables de entorno inválidas o ausentes:\n${detalle}\n\nRevisa .env.example.`,
    );
  }

  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}

/**
 * Google entra por Supabase Auth y hay que configurarlo allá primero. Mientras no lo
 * esté, el botón no se muestra: es preferible a ofrecer algo que falla al tocarlo.
 */
export function isGoogleAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
}
