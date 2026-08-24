import { defineRouting } from "next-intl/routing";

/**
 * La tienda pública es bilingüe: español (Venezuela) por defecto e inglés bajo `/en`.
 * `as-needed` deja el español sin prefijo, así la home de la tienda vive en `/`.
 *
 * El panel administrativo NO usa estas rutas: es solo español y cuelga de `/admin`,
 * excluido del middleware de i18n. Aun así lee sus textos del mismo archivo de mensajes,
 * porque ningún copy va incrustado en un componente.
 */
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
