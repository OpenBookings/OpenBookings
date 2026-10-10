export type ProtectionTaskId = "passkey" | "sessions";

export type OpenTask = {
  id: ProtectionTaskId;
  title: string;
  description: string;
  action: string;
};

export type CompletedTask = {
  id: ProtectionTaskId;
  label: string;
  /** When it was completed, for the passkey steps. */
  at?: string | Date | null;
  /** What to say instead of a time. */
  note?: string;
};

export type Protection = {
  done: number;
  total: number;
  headline: string;
  subline: string;
  /** The first step still open; the others wait their turn. */
  openTask: OpenTask | null;
  completed: CompletedTask[];
};

const LABELS: Record<ProtectionTaskId, string> = {
  passkey: "Passkey added",
  sessions: "Signed-in devices checked",
};

/**
 * The security page's checklist. Nothing here is stored: it is worked out
 * from the passkey and session lists every time, so a new device signing in
 * reopens its step by itself.
 *
 * One passkey is the goal. A second one is welcome but is not asked for.
 */
export function deriveProtection(input: {
  passkeys: { createdAt?: string | Date | null }[];
  otherSessionCount: number;
}): Protection {
  const { otherSessionCount } = input;
  const byAge = [...input.passkeys].sort(
    (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
  );
  const hasPasskey = byAge.length >= 1;
  const sessionsClear = otherSessionCount === 0;

  const open: OpenTask[] = [];
  const completed: CompletedTask[] = [];

  if (hasPasskey) completed.push({ id: "passkey", label: LABELS.passkey, at: byAge[0].createdAt });
  else
    open.push({
      id: "passkey",
      title: "Add a passkey",
      description: "Sign in without codes.",
      action: "Add passkey",
    });

  if (sessionsClear)
    completed.push({ id: "sessions", label: LABELS.sessions, note: "Only this device is signed in" });
  else
    open.push({
      id: "sessions",
      title: "Review signed-in devices",
      description:
        otherSessionCount === 1
          ? "1 other device is signed in."
          : `${otherSessionCount} other devices are signed in.`,
      action: "Review sessions",
    });

  let headline: string;
  let subline: string;
  if (!hasPasskey) {
    headline = "Secure your account";
    subline = "Add a passkey to sign in and confirm sensitive changes without codes.";
  } else if (sessionsClear) {
    headline = "Your account is fully protected";
    subline = "You have a passkey and no unknown sessions.";
  } else {
    headline = "One step left to full protection";
    subline = "Your account is protected by a passkey. Check the other devices that are signed in.";
  }

  return {
    done: completed.length,
    total: 2,
    headline,
    subline,
    openTask: open[0] ?? null,
    completed,
  };
}
