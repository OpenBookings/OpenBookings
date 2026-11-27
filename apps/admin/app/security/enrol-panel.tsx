"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { toDataURL } from "qrcode";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  beginPasskeyEnrolment,
  beginTotpEnrolment,
  finishPasskeyEnrolment,
  finishTotpEnrolment,
} from "@/lib/step-up/enrol-actions";

type PendingTotp = { qr: string; secretPreview: string };

/**
 * Adds a passkey or an authenticator app. The first one needs the bootstrap
 * code (ADMIN_BOOTSTRAP_CODE); later ones need a step-up with one you have.
 */
export function EnrolPanel({ firstCredential }: { firstCredential: boolean }) {
  const [bootstrap, setBootstrap] = useState("");
  const [totp, setTotp] = useState<PendingTotp | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const proof = firstCredential ? { bootstrap } : {};

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

  const addPasskey = () =>
    run(async () => {
      const options = await beginPasskeyEnrolment(proof);
      if (!options.ok) return options.error;
      const response = await startRegistration({ optionsJSON: options.value });
      const done = await finishPasskeyEnrolment(response);
      if (!done.ok) return done.error;
      setMessage({ error: false, text: "Passkey added." });
      setBootstrap("");
      return null;
    });

  const addAuthenticator = () =>
    run(async () => {
      const started = await beginTotpEnrolment(proof);
      if (!started.ok) return started.error;
      setTotp({ qr: await toDataURL(started.value.uri, { margin: 1, width: 200 }), secretPreview: started.value.secretPreview });
      setCode("");
      return null;
    });

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
        <Button type="button" variant="outline" disabled={pending} onClick={addPasskey}>
          Add passkey
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={addAuthenticator}>
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
    </div>
  );
}
