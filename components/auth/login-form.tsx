"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";

import { sendMagicLink, signInWithGoogle, type LoginFormState } from "@/app/(admin)/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL_STATE: LoginFormState = { status: "idle" };

function SubmitButton() {
  const t = useTranslations("auth");
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? t("sending") : t("sendLink")}
    </Button>
  );
}

export function LoginForm({
  next,
  googleEnabled,
  initialError,
}: {
  next: string;
  googleEnabled: boolean;
  initialError?: string;
}) {
  const t = useTranslations("auth");
  const [state, formAction] = useActionState(sendMagicLink, INITIAL_STATE);

  const errorMessage = state.status === "error" ? state.message : initialError;

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />

        <div className="space-y-2">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder={t("emailPlaceholder")}
            aria-describedby={errorMessage ? "login-error" : undefined}
            aria-invalid={errorMessage ? true : undefined}
          />
        </div>

        <SubmitButton />
      </form>

      {state.status === "sent" && (
        <p role="status" className="text-muted-foreground text-sm">
          {t("linkSent", { email: state.email })}
        </p>
      )}

      {errorMessage && (
        <p id="login-error" role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      )}

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3">
            <span className="bg-border h-px flex-1" />
            <span className="text-muted-foreground text-xs uppercase">{t("or")}</span>
            <span className="bg-border h-px flex-1" />
          </div>

          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <Button type="submit" variant="outline" className="w-full">
              {t("googleSignIn")}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
