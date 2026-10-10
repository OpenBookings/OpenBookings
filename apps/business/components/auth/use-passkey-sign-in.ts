"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth-client";
import { forgetPasskey, hasPasskeyHint, rememberPasskey } from "@/lib/passkey-hint";

/**
 * Offers passkey sign-in as soon as the login form is on screen.
 *
 * A browser that has used a passkey here before gets the system prompt
 * straight away. Every other browser gets passkey autofill on the email field
 * instead: opening the prompt for a host with no passkey shows them a
 * QR-code / security-key dialog they have to dismiss before they can type.
 *
 * Declining or failing is never an error — the email form is the fallback and
 * is already there.
 */
export function usePasskeySignIn(enabled: boolean) {
  // Once per mount: a second ceremony aborts the first, so a re-run effect
  // would cancel the prompt the host is looking at.
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    if (typeof window.PublicKeyCredential === "undefined") return;
    started.current = true;

    const signedIn = (method: "prompt" | "autofill") => {
      rememberPasskey();
      posthog.capture("sign_in_passkey", { method });
      // A full reload, so the server page sees the new session and applies
      // its own validated ?redirect= handling.
      window.location.reload();
    };

    const offerAutofill = async () => {
      const available =
        await window.PublicKeyCredential.isConditionalMediationAvailable?.();
      if (!available) return;
      // Resolves only when the host picks a passkey from the email field's
      // suggestions; otherwise it stays pending for the life of the page.
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (result && !result.error) signedIn("autofill");
    };

    const run = async () => {
      if (hasPasskeyHint()) {
        const result = await authClient.signIn.passkey();
        if (result && !result.error) return signedIn("prompt");
        // Dismissed, or the passkey is gone. Stop prompting unasked; the
        // next passkey sign-in on this browser turns it back on.
        forgetPasskey();
      }
      await offerAutofill();
    };

    run().catch(() => {
      // The email form is still there.
    });
  }, [enabled]);
}
