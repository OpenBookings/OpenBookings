"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Mail } from "lucide-react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { describeDevice } from "@/lib/device";
import { isPasskeyPromptCancelled, passkeyErrorMessage } from "@/lib/passkey-errors";
import { PendingButton } from "../../_components/pending-button";
import { Row, RowList, Section } from "../../_components/section";
import {
  AccountDialog,
  PasskeyNameDialog,
  RemovePasskeyDialog,
  useAction,
  type ActionResult,
} from "./passkey-dialogs";
import { PasskeysSection, SessionsSection, passkeyLabel, type Passkey, type Session } from "./security-sections";

type OpenDialog =
  | { kind: "email" }
  | { kind: "add" }
  | { kind: "rename"; passkey: Passkey }
  | { kind: "remove"; passkey: Passkey }
  | null;

function activity(session: Session): number {
  return new Date(session.updatedAt ?? session.createdAt ?? 0).getTime();
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/;

function EmailChangeForm({ email, onClose }: { email: string; onClose: () => void }) {
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { pending, error, start } = useAction(async (): Promise<ActionResult> => {
    const next = newEmail.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(next)) return { ok: false, error: "Enter a valid email address." };
    if (next === email.toLowerCase()) return { ok: false, error: "That's already your sign-in email." };
    try {
      const result = await authClient.changeEmail({ newEmail: next, callbackURL: "/account/security" });
      if (result.error) {
        const code = "code" in result.error ? result.error.code : undefined;
        if (code === "SESSION_EXPIRED" || result.error.status === 401) {
          return { ok: false, error: "For your security, sign in again to change your email." };
        }
        return { ok: false, error: "Could not start the change. Try again." };
      }
      posthog.capture("email_change_requested");
      // The same answer whether or not the address is already taken: what
      // happens next is in the emails, and nobody learns who has an account.
      setSentTo(email);
      return { ok: false };
    } catch {
      return { ok: false, error: "Could not start the change. Check your connection and try again." };
    }
  }, onClose);

  if (sentTo) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Check your inbox</DialogTitle>
          <DialogDescription>
            We sent a link to {sentTo}. Open it to confirm, then open the link we send to your new address. Your sign-in
            email changes after the second link.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <PendingButton autoFocus onClick={onClose}>
            Done
          </PendingButton>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <DialogHeader>
        <DialogTitle>Change your email</DialogTitle>
        <DialogDescription>
          You sign in and get booking emails at this address. We confirm the change with both your current and your new
          inbox.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-email">New email</Label>
        <Input
          id="new-email"
          type="email"
          autoFocus
          autoComplete="email"
          className="h-11 bg-background dark:bg-background"
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby="new-email-error"
        />
        <p id="new-email-error" aria-live="polite" className="text-[13px] text-(--red-11) empty:hidden">
          {error}
        </p>
      </div>
      <DialogFooter>
        <PendingButton type="button" variant="outline" onClick={onClose}>
          Cancel
        </PendingButton>
        <PendingButton type="submit" pending={pending} disabled={!newEmail.trim()}>
          Send confirmation
        </PendingButton>
      </DialogFooter>
    </form>
  );
}

export function SecurityPanel({ email }: { email: string }) {
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [passkeysFailed, setPasskeysFailed] = useState(false);
  const [sessionsFailed, setSessionsFailed] = useState(false);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const sessionsHeading = React.useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(async () => {
    const [passkeyResult, sessionsResult, current] = await Promise.all([
      authClient.passkey.listUserPasskeys(),
      authClient.listSessions(),
      authClient.getSession(),
    ]);
    if (passkeyResult.data) setPasskeys(passkeyResult.data as Passkey[]);
    if (sessionsResult.data) setSessions(sessionsResult.data as Session[]);
    if (current.data) setCurrentToken(current.data.session.token);
    setPasskeysFailed(!passkeyResult.data);
    // Without the current session there is no telling which row is this device.
    setSessionsFailed(!sessionsResult.data || !current.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load-on-mount, as on the host security page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const retry = async () => {
    setRetrying(true);
    try {
      await refresh();
    } catch {
      // Still failing; the retry card stays.
    } finally {
      setRetrying(false);
    }
  };

  const orderedSessions = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        if (a.token === currentToken) return -1;
        if (b.token === currentToken) return 1;
        return activity(b) - activity(a);
      }),
    [sessions, currentToken],
  );
  const otherSessions = orderedSessions.filter((session) => session.token !== currentToken);

  const addPasskey = async (name: string): Promise<ActionResult> => {
    try {
      const result = await authClient.passkey.addPasskey({ name: name || describeDevice(navigator.userAgent) });
      if (result?.error) {
        if (isPasskeyPromptCancelled(result.error)) return { ok: false };
        return { ok: false, error: passkeyErrorMessage(result.error, "Could not add the passkey. Try again.") };
      }
      if (!(result && "data" in result && result.data)) return { ok: false };
      posthog.capture("passkey_added");
      toast.success("Passkey added");
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "Passkeys are not supported on this device or browser." };
    }
  };

  const renamePasskey = async (passkey: Passkey, name: string): Promise<ActionResult> => {
    try {
      const result = await authClient.passkey.updatePasskey({ id: passkey.id, name });
      if (result.error) {
        return { ok: false, error: passkeyErrorMessage(result.error, "Could not rename the passkey. Try again.") };
      }
      toast.success("Passkey renamed");
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not rename the passkey. Check your connection and try again." };
    }
  };

  const removePasskey = async (passkey: Passkey): Promise<ActionResult> => {
    try {
      const result = await authClient.passkey.deletePasskey({ id: passkey.id });
      if (result.error) {
        await refresh();
        return { ok: false, error: passkeyErrorMessage(result.error, "Could not remove the passkey. Try again.") };
      }
      posthog.capture("passkey_removed");
      toast.success("Passkey removed");
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not remove the passkey. Check your connection and try again." };
    }
  };

  const signOutSession = async (session: Session) => {
    setSessions((list) => list.filter((s) => s.token !== session.token));
    const restore = () => {
      setSessions((list) => (list.some((s) => s.token === session.token) ? list : [...list, session]));
      toast.error("Could not sign that session out. Try again.");
    };
    try {
      const result = await authClient.revokeSession({ token: session.token });
      if (result.error) restore();
      else toast.success("Session signed out");
    } catch {
      restore();
    }
  };

  const signOutOthers = async () => {
    const count = otherSessions.length;
    setSigningOutOthers(true);
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) toast.error("Could not sign the other sessions out. Try again.");
      else toast.success(`Signed out of ${count} other ${count === 1 ? "session" : "sessions"}`);
    } catch {
      toast.error("Could not sign the other sessions out. Check your connection and try again.");
    } finally {
      await refresh().catch(() => {});
      setSigningOutOthers(false);
    }
  };

  const close = () => setDialog(null);
  const load = { loading, retrying, onRetry: () => void retry() };

  return (
    <>
      <Section id="security-email" title="Email" helper="Where your sign-in links and booking emails go.">
        <RowList>
          <ul>
            <Row
              icon={<Mail aria-hidden className="size-5" />}
              name={email}
              meta="Your sign-in email"
              actions={
                <PendingButton variant="outline" onClick={() => setDialog({ kind: "email" })}>
                  Change email
                </PendingButton>
              }
            />
          </ul>
        </RowList>
      </Section>

      <PasskeysSection
        passkeys={passkeys}
        load={{ ...load, failed: passkeysFailed }}
        onAdd={() => setDialog({ kind: "add" })}
        onRename={(passkey) => setDialog({ kind: "rename", passkey })}
        onRemove={(passkey) => setDialog({ kind: "remove", passkey })}
      />

      <SessionsSection
        sessions={orderedSessions}
        currentToken={currentToken}
        load={{ ...load, failed: sessionsFailed }}
        headingRef={sessionsHeading}
        signingOutOthers={signingOutOthers}
        onSignOut={(session) => void signOutSession(session)}
        onSignOutOthers={() => void signOutOthers()}
      />

      <p className="flex items-start gap-2 border-t pt-5 text-[13px] text-muted-foreground">
        <Bell aria-hidden className="mt-0.5 size-4 shrink-0" />
        We email you whenever a passkey is added or your sign-in email changes.
      </p>

      <AccountDialog open={dialog?.kind === "email"} onClose={close}>
        <EmailChangeForm email={email} onClose={close} />
      </AccountDialog>
      <PasskeyNameDialog
        open={dialog?.kind === "add" || dialog?.kind === "rename"}
        mode={dialog?.kind === "rename" ? "rename" : "add"}
        initialName={dialog?.kind === "rename" ? (dialog.passkey.name ?? "") : ""}
        email={email}
        onSubmit={(name) => (dialog?.kind === "rename" ? renamePasskey(dialog.passkey, name) : addPasskey(name))}
        onClose={close}
      />
      <RemovePasskeyDialog
        open={dialog?.kind === "remove"}
        name={dialog?.kind === "remove" ? passkeyLabel(dialog.passkey) : ""}
        onConfirm={() => (dialog?.kind === "remove" ? removePasskey(dialog.passkey) : Promise.resolve({ ok: false }))}
        onClose={close}
      />
    </>
  );
}
