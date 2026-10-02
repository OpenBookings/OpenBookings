"use client";

import * as React from "react";
import { authClient } from "@/lib/auth-client";
import { isStepUpRequired } from "@/lib/step-up";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Result = { error?: { code?: string; message?: string } | null } | undefined | null;
type Action = () => Promise<Result>;

/**
 * Runs sensitive account actions behind the step-up gate.
 *
 * `guard(action)` runs the action. If the server refuses it for want of a
 * recent verification, the dialog asks for one (passkey, authenticator code or
 * recovery code) and then runs the same action once more. The server decides;
 * this only gives the host a way to satisfy it without losing what they were
 * doing.
 */
export function useStepUp(hasFactor: boolean) {
  const [pending, setPending] = React.useState<{
    action: Action;
    resolve: (result: Result) => void;
  } | null>(null);

  const guard = React.useCallback(async (action: Action): Promise<Result> => {
    const result = await action();
    if (!isStepUpRequired(result)) return result;
    return new Promise<Result>((resolve) => setPending({ action, resolve }));
  }, []);

  const dialog = (
    <StepUpDialog
      open={pending !== null}
      hasFactor={hasFactor}
      onCancel={() => {
        pending?.resolve({ error: { code: "STEP_UP_CANCELLED", message: "Cancelled." } });
        setPending(null);
      }}
      onVerified={async () => {
        if (!pending) return;
        const { action, resolve } = pending;
        setPending(null);
        // Once. If it is refused again the caller shows the error.
        resolve(await action());
      }}
    />
  );

  return { guard, dialog };
}

function StepUpDialog({
  open,
  hasFactor,
  onCancel,
  onVerified,
}: {
  open: boolean;
  hasFactor: boolean;
  onCancel: () => void;
  onVerified: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so a half-typed code never survives into
            the next prompt. */}
        {open ? (
          <StepUpBody hasFactor={hasFactor} onCancel={onCancel} onVerified={onVerified} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StepUpBody({
  hasFactor,
  onCancel,
  onVerified,
}: {
  hasFactor: boolean;
  onCancel: () => void;
  onVerified: () => void;
}) {
  const [mode, setMode] = React.useState<"totp" | "backup">("totp");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const attempt = async (verify: () => Promise<Result>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await verify();
      if (result?.error) setError(failure);
      else onVerified();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
        <DialogHeader>
          <DialogTitle>Confirm it&apos;s you</DialogTitle>
          <DialogDescription>
            {hasFactor
              ? "This change needs a fresh check with your passkey or authenticator app."
              : "This change needs a recent sign-in. Sign out and back in, then try again."}
          </DialogDescription>
        </DialogHeader>

        {hasFactor ? (
          <div className="flex flex-col gap-4">
            <Button
              disabled={busy}
              onClick={() =>
                attempt(
                  () => authClient.signIn.passkey() as Promise<Result>,
                  "The passkey check was cancelled or did not match.",
                )
              }
            >
              Use passkey
            </Button>

            <div className="flex flex-col gap-2">
              <label htmlFor="step-up-code" className="text-sm text-muted-foreground">
                {mode === "totp" ? "Or enter the 6-digit code from your authenticator app" : "Enter a recovery code"}
              </label>
              <div className="flex gap-2">
                <Input
                  id="step-up-code"
                  inputMode={mode === "totp" ? "numeric" : "text"}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={busy || code.trim().length < 6}
                  onClick={() =>
                    attempt(
                      () =>
                        (mode === "totp"
                          ? authClient.twoFactor.verifyTotp({ code: code.trim() })
                          : authClient.twoFactor.verifyBackupCode({ code: code.trim() })) as Promise<Result>,
                      "That code didn't match.",
                    )
                  }
                >
                  Verify
                </Button>
              </div>
              <button
                type="button"
                className="self-start text-xs text-muted-foreground underline underline-offset-2"
                onClick={() => {
                  setMode(mode === "totp" ? "backup" : "totp");
                  setCode("");
                  setError(null);
                }}
              >
                {mode === "totp" ? "Use a recovery code instead" : "Use an authenticator code instead"}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
    </>
  );
}
