import * as Sentry from "@sentry/nextjs";

import { SENTRY_COMMON_OPTIONS, isSentryEnabled } from "@/lib/sentry";

if (isSentryEnabled) {
  Sentry.init({
    ...SENTRY_COMMON_OPTIONS,
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
