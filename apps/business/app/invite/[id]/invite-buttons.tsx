"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { acceptInvite, declineInvite } from "./actions";

export function InviteButtons({ invitationId }: { invitationId: string }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run(action: (id: string) => Promise<{ error: string } | undefined>) {
    setBusy(true);
    setError(null);
    try {
      // On success the action redirects, so a result here means it failed.
      const result = await action(invitationId);
      if (result?.error) setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(acceptInvite)}>
          Accept and join
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(declineInvite)}>
          Decline
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** For an invitation addressed to someone else: sign out, then sign back in here. */
export function SwitchAccountButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        router.push(`/login?redirect=${encodeURIComponent(`/invite/${invitationId}`)}`);
      }}
    >
      Sign in with another email
    </Button>
  );
}
