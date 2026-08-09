"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "ob-passkey-nudge-dismissed";

/**
 * Enrollment prompt (task 14): shown after sign-in until the host has at
 * least one passkey. Dismissal is per-browser (localStorage), so it comes
 * back on a new device — which is exactly a moment they should enroll it.
 */
export function PasskeyNudge() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(DISMISS_KEY)) return;
    let cancelled = false;
    authClient.passkey
      .listUserPasskeys()
      .then((result) => {
        if (!cancelled && result.data && result.data.length === 0) {
          setVisible(true);
        }
      })
      .catch(() => {
        // Not being able to check is never a reason to nag.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2 text-sm lg:px-6">
      <p className="min-w-0">
        <span className="font-medium">Protect your payouts:</span> add a
        passkey so sensitive changes need your fingerprint or face, not just
        an email link. Passkeys sync via iCloud Keychain / Google Password
        Manager.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm">
          <Link href="/account/security">Add passkey</Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            window.localStorage.setItem(DISMISS_KEY, "1");
            setVisible(false);
          }}
        >
          Later
        </Button>
      </div>
    </div>
  );
}
