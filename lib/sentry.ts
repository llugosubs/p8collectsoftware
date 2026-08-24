/**
 * Sentry solo arranca si hay DSN. Sin él, todo el monitoreo queda inerte y en
 * silencio, que es justo lo que se quiere en local y en CI.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

export const isSentryEnabled = SENTRY_DSN.length > 0;

export const SENTRY_COMMON_OPTIONS = {
  dsn: SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Los montos, correos y comprobantes no viajan a un tercero.
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
} as const;
