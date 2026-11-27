"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { toDataURL } from "qrcode";
import { useState, useTransition } from "react";
import { DangerousDialog } from "@/components/dangerous-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  beginPasskeyEnrolment,
  beginTotpEnrolment,
  finishPasskeyEnrolment,
  finishTotpEnrolment,
} from "@/lib/step-up/enrol-actions";

type PendingTotp = { qr: string; secretPreview: string };
type Kind = "passkey" | "totp";
type Proof = { bootstrap?: string; stepUpToken?: string };

const STEP_UP_SUMMARY: Record<Kind, string> = {
  passkey: "Add a new passkey to your admin account.",
  totp: "Add a new authenticator app to your admin account.",
};

/**
 * Adds a passkey or an authenticator app. The first one needs the bootstrap
 * code (ADMIN_BOOTSTRAP_CODE); later ones need a step-up with one you have
 * (action "security.enrol" on yourself), which beginning the enrolment spends.
 */
export function EnrolPanel({ firstCredential, userId }: { firstCredential: boolean; userId: string }) {
  const [bootstrap, setBootstrap] = useState("");
  const [totp, setTotp] = useState<PendingTotp | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [stepUpFor, setStepUpFor] = useState<Kind | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<string | null>) =>
    start(async () => {
      setMessage(null);
      try {
        const error = await fn();
        if (error) setMessage({ error: true, text: error });
      } catch (err) {
        setMessage({ error: true, text: err instanceof Error ? err.message : String(err) });
      }
    });

  /** Enrols a passkey; the error to show, or null. */
  async function enrolPasskey(proof: Proof): Promise<string | null> {
    const options = await beginPasskeyEnrolment(proof);
    if (!options.ok) return options.error;
    let response;
    try {
      response = await startRegistration({ optionsJSON: options.value });
    } catch {
      return "The passkey was not created. Try again.";
    }
    const done = await finishPasskeyEnrolment(response);
    if (!done.ok) return done.error;
    setMessage({ error: false, text: "Passkey added." });
    setBootstrap("");
    return null;
  }

  /** Starts adding an authenticator app (its QR code shows below); the error to show, or null. */
  async function enrolAuthenticator(proof: Proof): Promise<string | null> {
    const started = await beginTotpEnrolment(proof);
    if (!started.ok) return started.error;
    setTotp({ qr: await toDataURL(started.value.uri, { margin: 1, width: 200 }), secretPreview: started.value.secretPreview });
    setCode("");
    return null;
  }

  const enrol = (kind: Kind, proof: Proof) => (kind === "passkey" ? enrolPasskey(proof) : enrolAuthenticator(proof));

  /** The first one with the bootstrap code; a later one after a step-up. */
  const add = (kind: Kind) => {
    setMessage(null);
    if (firstCredential) run(() => enrol(kind, { bootstrap }));
    else setStepUpFor(kind);
  };

  const confirmAuthenticator = () =>
    run(async () => {
      const done = await finishTotpEnrolment(code);
      if (!done.ok) return done.error;
      setTotp(null);
      setBootstrap("");
      setMessage({ error: false, text: "Authenticator app added." });
      return null;
    });

  return (
    <div className="space-y-3 rounded-md border p-4">
      {firstCredential ? (
        <label className="flex flex-col gap-1 text-sm">
          Bootstrap code
          <Input
            type="password"
            autoComplete="off"
            value={bootstrap}
            onChange={(e) => setBootstrap(e.target.value)}
            className="w-72"
          />
          <span className="text-xs text-muted-foreground">Your first one needs the code set in ADMIN_BOOTSTRAP_CODE.</span>
        </label>
      ) : (
        <p className="text-sm text-muted-foreground">Adding another one asks for one you have first.</p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => add("passkey")}>
          Add passkey
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => add("totp")}>
          Add authenticator app
        </Button>
      </div>

      {totp && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            confirmAuthenticator();
          }}
        >
          <p className="text-sm">Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise */}
          <img src={totp.qr} alt="QR code for your authenticator app" width={200} height={200} />
          <p className="text-xs text-muted-foreground">
            Or type this key: <span className="font-mono">{totp.secretPreview}</span>
          </p>
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="w-32"
              aria-label="6-digit code"
            />
            <Button type="submit" disabled={pending}>
              Confirm
            </Button>
          </div>
        </form>
      )}

      {message && <p className={message.error ? "text-sm text-destructive" : "text-sm"}>{message.text}</p>}

      {stepUpFor ? (
        <DangerousDialog
          stepUpOnly
          open
          onOpenChange={(open) => {
            if (!open) setStepUpFor(null);
          }}
          action="security.enrol"
          targetId={userId}
          summary={STEP_UP_SUMMARY[stepUpFor]}
          // The step-up is spent by beginning the enrolment; a refusal shows in the dialog.
          onConfirm={(_reason, stepUpToken) => enrol(stepUpFor, { stepUpToken })}
        />
      ) : null}
    </div>
  );
}
