"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
export function useStepUp(factors: { hasPasskey: boolean; hasAuthenticator: boolean }) {
  const [pending, setPending] = React.useState<{
    action: Action;
    resolve: (result: Result) => void;
  } | null>(null);

  const guard = React.useCallback(async (action: Action): Promise<Result> => {
    const result = await action();
    if (!isStepUpRequired(result)) return result;
    return new Promise<Result>((resolve) =>
      setPending((current) => {
        // One prompt at a time: a second gated action while the dialog is open
        // is turned away rather than silently replacing the first.
        if (current) {
          resolve({ error: { code: "STEP_UP_BUSY", message: "Finish the verification that is already open." } });
          return current;
        }
        return { action, resolve };
      }),
    );
  }, []);

  const dialog = (
    <StepUpDialog
      open={pending !== null}
      factors={factors}
      onCancel={() => {
        // Not an error to show: the host changed their mind.
        pending?.resolve({ error: null });
        setPending(null);
      }}
      onVerified={async () => {
        if (!pending) return;
        const { action, resolve } = pending;
        setPending(null);
        // Once. If it is refused again the caller shows the error. The promise
        // must settle whatever happens, or the caller's busy state sticks.
        try {
          resolve(await action());
        } catch {
          resolve({ error: { code: "STEP_UP_FAILED", message: "Something went wrong. Please try again." } });
        }
      }}
    />
  );

  return { guard, dialog };
}

function StepUpDialog({
  open,
  factors,
  onCancel,
  onVerified,
}: {
  open: boolean;
  factors: { hasPasskey: boolean; hasAuthenticator: boolean };
  onCancel: () => void;
  onVerified: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so a half-typed code never survives into
            the next prompt. */}
        {open ? (
          <StepUpBody factors={factors} onCancel={onCancel} onVerified={onVerified} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StepUpBody({
  factors,
  onCancel,
  onVerified,
}: {
  factors: { hasPasskey: boolean; hasAuthenticator: boolean };
  onCancel: () => void;
  onVerified: () => void;
}) {
  const router = useRouter();
  const hasFactor = factors.hasPasskey || factors.hasAuthenticator;
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
              : "This change needs a recent sign-in. Sign in again, then come back and try once more."}
          </DialogDescription>
        </DialogHeader>

        {hasFactor ? (
          <div className="flex flex-col gap-4">
            {factors.hasPasskey ? (
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
            ) : null}

            {factors.hasAuthenticator ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="step-up-code" className="text-sm text-muted-foreground">
                {mode === "totp"
                  ? "Enter the 6-digit code from your authenticator app"
                  : "Enter a recovery code. Each one works once, so keep them for when you have nothing else."}
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
            ) : null}
          </div>
        ) : (
          <Button
            onClick={async () => {
              await authClient.signOut();
              router.push("/login");
            }}
          >
            Sign in again
          </Button>
        )}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
    </>
  );
}
