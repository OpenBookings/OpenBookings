"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth-client";
import { forgetPasskey, hasPasskeyHint, rememberPasskey } from "@/lib/passkey-hint";

const noSubscription = () => () => {};

function finishSignIn(method: "prompt" | "autofill" | "button") {
  rememberPasskey();
  posthog.capture("sign_in_passkey", { method });
  // A full reload, so the server page sees the new session and applies
  // its own validated ?redirect= handling.
  window.location.reload();
}

/**
 * Offers passkey sign-in as soon as the login form is on screen, and returns
 * what the "Sign in with a passkey" button needs.
 *
 * `supported` is false on the server and for the first client render, so the
 * button never causes a hydration mismatch, and stays false in browsers
 * without WebAuthn. `signIn` is the explicit, user-started ceremony: it opens
 * the system prompt now (a second ceremony aborts any pending autofill one)
 * and resolves true once the host is signed in, false if they dismissed it or
 * it failed.
 *
 * On load, a browser that has used a passkey here before gets the system prompt
 * straight away. Every other browser gets passkey autofill on the email field
 * instead: opening the prompt for a host with no passkey shows them a
 * QR-code / security-key dialog they have to dismiss before they can type.
 *
 * Declining or failing is never an error — the email form is the fallback and
 * is already there.
 */
export function usePasskeySignIn(enabled: boolean) {
  // false on the server and during hydration, then the browser's real answer.
  const supported = useSyncExternalStore(
    noSubscription,
    () => typeof window.PublicKeyCredential !== "undefined",
    () => false,
  );

  const signIn = useCallback(async (): Promise<boolean> => {
    try {
      const result = await authClient.signIn.passkey();
      if (result && !result.error) {
        finishSignIn("button");
        return true;
      }
    } catch {
      // Treated like a dismissed prompt.
    }
    return false;
  }, []);

  // Once per mount: a second ceremony aborts the first, so a re-run effect
  // would cancel the prompt the host is looking at.
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    if (typeof window.PublicKeyCredential === "undefined") return;
    started.current = true;

    const signedIn = finishSignIn;

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

  return { supported, signIn };
}
