"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { describeDevice } from "@/lib/device";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStepUp } from "@/components/security/step-up-dialog";
import { rememberPasskey } from "@/lib/passkey-hint";
import { isPasskeyPromptCancelled, passkeyErrorMessage } from "@/lib/passkey-errors";
import { deriveProtection, type ProtectionTaskId } from "@/lib/security-tasks";
import {
  LastPasskeyDialog,
  PasskeyNameDialog,
  RemovePasskeyDialog,
  type ActionResult,
} from "./_components/passkey-dialogs";
import { ProtectionCard } from "./_components/protection-card";
import {
  PasskeysSection,
  SessionsSection,
  passkeyLabel,
  type Passkey,
  type Session,
} from "./_components/security-sections";

/** Which dialog is open, and for which passkey. One at a time. */
type OpenDialog =
  | { kind: "add" }
  | { kind: "rename"; passkey: Passkey }
  | { kind: "remove"; passkey: Passkey }
  | { kind: "last"; passkey: Passkey }
  | null;

function activity(session: Session): number {
  return new Date(session.updatedAt ?? session.createdAt ?? 0).getTime();
}

export function SecurityPanel() {
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [passkeysFailed, setPasskeysFailed] = useState(false);
  const [sessionsFailed, setSessionsFailed] = useState(false);

  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  // Setup for the authenticator app is no longer offered here; a host who
  // enabled one earlier can still use it to pass the step-up check.
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const sessionsHeading = useRef<HTMLHeadingElement>(null);

  // Adding or removing a factor is gated: the server asks for a fresh check
  // first, and this turns that refusal into a prompt instead of an error.
  const { guard, dialog: stepUpDialog } = useStepUp({
    hasPasskey: passkeys.length > 0,
    hasAuthenticator: twoFactorEnabled,
  });

  // Reloads the lists. A list that fails to load keeps what it last showed
  // out of sight behind its own retry card; the other one is unaffected.
  const refresh = useCallback(async () => {
    const [passkeyResult, sessionsResult, current] = await Promise.all([
      authClient.passkey.listUserPasskeys(),
      authClient.listSessions(),
      authClient.getSession(),
    ]);
    if (passkeyResult.data) setPasskeys(passkeyResult.data as Passkey[]);
    if (sessionsResult.data) setSessions(sessionsResult.data as Session[]);
    if (current.data) {
      setCurrentToken(current.data.session.token);
      setEmail(current.data.user.email);
      const user = current.data.user as { twoFactorEnabled?: boolean | null };
      setTwoFactorEnabled(!!user.twoFactorEnabled);
    }
    setPasskeysFailed(!passkeyResult.data);
    // Without the current session there is no telling which row is this device.
    setSessionsFailed(!sessionsResult.data || !current.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load-on-mount: refresh() fetches passkeys, sessions and the 2FA flag and
    // sets them. Left as an effect deliberately; reworking it means
    // restructuring the panel's data flow, which does not belong in a lint pass.
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
  const protection = deriveProtection({ passkeys, otherSessionCount: otherSessions.length });

  const addPasskey = async (name: string): Promise<ActionResult> => {
    try {
      const result = await guard(() =>
        authClient.passkey.addPasskey({ name: name || describeDevice(navigator.userAgent) }),
      );
      if (result?.error) {
        // Dismissing the browser's prompt leaves the dialog as it was.
        if (isPasskeyPromptCancelled(result.error)) return { ok: false };
        return {
          ok: false,
          error: passkeyErrorMessage(result.error, "Could not add the passkey. Try again."),
        };
      }
      // No error and no data: the verification prompt was dismissed.
      if (!(result && "data" in result && result.data)) return { ok: false };
      // The login page may now open the passkey prompt on this browser.
      rememberPasskey();
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
      const result = await guard(() => authClient.passkey.deletePasskey({ id: passkey.id }));
      if (result?.error) {
        // The server may know better than this page did (LAST_PASSKEY).
        await refresh();
        return { ok: false, error: passkeyErrorMessage(result.error, "Could not remove the passkey. Try again.") };
      }
      if (!(result && "data" in result && result.data)) return { ok: false };
      toast.success("Passkey removed");
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not remove the passkey. Check your connection and try again." };
    }
  };

  const signOutSession = async (session: Session) => {
    // Gone at once; put back if the server did not agree.
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

  const onTask = (task: ProtectionTaskId) => {
    if (task !== "sessions") return setDialog({ kind: "add" });
    const heading = sessionsHeading.current;
    if (!heading) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    heading.focus({ preventScroll: true });
  };

  const close = () => setDialog(null);
  const load = { loading, retrying, onRetry: () => void retry() };

  return (
    <>
      {stepUpDialog}

      <header>
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">Security</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your passkeys, and the devices signed in to your account.
        </p>
      </header>

      {loading ? (
        <Card className="gap-4 p-6">
          <div className="flex items-center gap-5">
            <Skeleton className="size-14 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-64 max-w-full" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-[78px] w-full rounded-xl" />
        </Card>
      ) : passkeysFailed || sessionsFailed ? null : (
        <ProtectionCard protection={protection} onAction={onTask} />
      )}

      <PasskeysSection
        passkeys={passkeys}
        load={{ ...load, failed: passkeysFailed }}
        onAdd={() => setDialog({ kind: "add" })}
        onRename={(passkey) => setDialog({ kind: "rename", passkey })}
        onRemove={(passkey) =>
          // Nothing is sent for the last one; the server would refuse it anyway.
          setDialog({ kind: passkeys.length === 1 ? "last" : "remove", passkey })
        }
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
        Every owner is emailed whenever a new device signs in.
      </p>

      <PasskeyNameDialog
        open={dialog?.kind === "add" || dialog?.kind === "rename"}
        mode={dialog?.kind === "rename" ? "rename" : "add"}
        initialName={dialog?.kind === "rename" ? (dialog.passkey.name ?? "") : ""}
        email={email}
        onSubmit={(name) =>
          dialog?.kind === "rename" ? renamePasskey(dialog.passkey, name) : addPasskey(name)
        }
        onClose={close}
      />
      <RemovePasskeyDialog
        open={dialog?.kind === "remove"}
        name={dialog?.kind === "remove" ? passkeyLabel(dialog.passkey) : ""}
        onConfirm={() =>
          dialog?.kind === "remove" ? removePasskey(dialog.passkey) : Promise.resolve({ ok: false })
        }
        onClose={close}
      />
      <LastPasskeyDialog
        open={dialog?.kind === "last"}
        name={dialog?.kind === "last" ? passkeyLabel(dialog.passkey) : ""}
        onAddAnother={() => setDialog({ kind: "add" })}
        onClose={close}
      />
    </>
  );
}
