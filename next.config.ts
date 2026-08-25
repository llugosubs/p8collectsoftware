import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** Las fotos de inventario se sirven desde Storage, con las transformaciones de Supabase. */
function supabaseImagePattern() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];

  try {
    // El protocolo y el puerto salen de la URL real: en desarrollo el Supabase
    // local vive en http://127.0.0.1:54321, y fijar "https" dejaría el grid sin
    // fotos justo donde se prueba.
    const { hostname, protocol, port } = new URL(url);
    return [
      {
        protocol: protocol === "http:" ? ("http" as const) : ("https" as const),
        hostname,
        ...(port ? { port } : {}),
        pathname: "/storage/v1/object/public/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El indicador de desarrollo se planta justo encima del primer botón del
  // bottom nav y estorba al probar el panel en móvil.
  devIndicators: false,
  images: {
    remotePatterns: supabaseImagePattern(),
  },
  eslint: {
    dirs: ["app", "components", "lib", "i18n", "e2e"],
  },
};

const config = withNextIntl(nextConfig);

// Sin DSN no se envuelve nada: el plugin de Sentry solo estorbaría al build.
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      disableLogger: true,
    })
  : config;
