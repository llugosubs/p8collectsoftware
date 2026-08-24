import { getRequestConfig } from "next-intl/server";

import { routing, type Locale } from "./routing";

function isSupportedLocale(value: string | undefined): value is Locale {
  return value !== undefined && routing.locales.includes(value as Locale);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;

  // Las rutas del panel no llevan segmento de idioma: caen al español por defecto.
  const locale: Locale = isSupportedLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
