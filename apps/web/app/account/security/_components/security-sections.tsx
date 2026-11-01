import * as React from "react";
import { KeyRound, Laptop } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatSecurityTimestamp } from "@/lib/security-timestamp";
import { describeDevice } from "@/lib/device";
import { DANGER_OUTLINE, PendingButton } from "../../_components/pending-button";
import { LoadError, Row, RowList, Section, SkeletonRows } from "../../_components/section";

export type Passkey = {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
  backedUp?: boolean;
};

export type Session = {
  token: string;
  userAgent?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export function passkeyLabel(passkey: Passkey): string {
  return passkey.name || "Unnamed passkey";
}

type LoadState = { loading: boolean; failed: boolean; retrying: boolean; onRetry: () => void };

export function PasskeysSection({
  passkeys,
  load,
  onAdd,
  onRename,
  onRemove,
}: {
  passkeys: Passkey[];
  load: LoadState;
  onAdd: () => void;
  onRename: (passkey: Passkey) => void;
  onRemove: (passkey: Passkey) => void;
}) {
  const ready = !load.loading && !load.failed;
  return (
    <Section
      id="security-passkeys"
      title="Passkeys"
      helper="Sign in with your face, fingerprint or screen lock instead of an email link."
      action={
        <PendingButton variant="outline" className="max-sm:w-full" disabled={!ready} onClick={onAdd}>
          Add passkey
        </PendingButton>
      }
      footnote={ready && passkeys.length === 0 ? "No passkeys yet. Add one to sign in with your face, fingerprint or screen lock." : null}
    >
      {load.loading ? (
        <SkeletonRows />
      ) : load.failed ? (
        <LoadError what="passkeys" onRetry={load.onRetry} retrying={load.retrying} />
      ) : passkeys.length > 0 ? (
        <RowList>
          <ul className="divide-y">
            {passkeys.map((passkey) => {
              const added = formatSecurityTimestamp(passkey.createdAt);
              return (
                <Row
                  key={passkey.id}
                  icon={<KeyRound aria-hidden className="size-5" />}
                  name={passkeyLabel(passkey)}
                  chip={
                    <Badge variant="secondary" className="text-muted-foreground">
                      {passkey.backedUp ? "Synced" : "This device only"}
                    </Badge>
                  }
                  meta={added ? `Added ${added}` : "Added earlier"}
                  actions={
                    <>
                      <PendingButton variant="outline" onClick={() => onRename(passkey)}>
                        Rename
                      </PendingButton>
                      <PendingButton variant="outline" className={DANGER_OUTLINE} onClick={() => onRemove(passkey)}>
                        Remove
                      </PendingButton>
                    </>
                  }
                />
              );
            })}
          </ul>
        </RowList>
      ) : null}
    </Section>
  );
}

export function SessionsSection({
  sessions,
  currentToken,
  load,
  headingRef,
  signingOutOthers,
  onSignOut,
  onSignOutOthers,
}: {
  /** Current session first, then most recently active. */
  sessions: Session[];
  currentToken: string | null;
  load: LoadState;
  headingRef: React.Ref<HTMLHeadingElement>;
  signingOutOthers: boolean;
  onSignOut: (session: Session) => void;
  onSignOutOthers: () => void;
}) {
  const ready = !load.loading && !load.failed;
  const others = sessions.filter((session) => session.token !== currentToken).length;
  return (
    <Section
      id="security-sessions"
      title="Active sessions"
      helper="Everywhere this account is signed in."
      headingRef={headingRef}
      action={
        <PendingButton
          variant="outline"
          className="max-sm:w-full"
          disabled={!ready || others === 0}
          pending={signingOutOthers}
          onClick={onSignOutOthers}
        >
          Sign out other sessions
        </PendingButton>
      }
      footnote={ready ? "Don't recognise a session? Sign it out, then remove any passkey you didn't add." : null}
    >
      {load.loading ? (
        <SkeletonRows />
      ) : load.failed ? (
        <LoadError what="sessions" onRetry={load.onRetry} retrying={load.retrying} />
      ) : (
        <RowList>
          <ul className="divide-y">
            {sessions.map((session) => {
              const current = session.token === currentToken;
              const signedIn = formatSecurityTimestamp(session.createdAt);
              return (
                <Row
                  key={session.token}
                  icon={<Laptop aria-hidden className="size-5" />}
                  name={describeDevice(session.userAgent)}
                  chip={
                    current ? (
                      <Badge className="bg-(--green-3) text-(--green-11)">
                        <span aria-hidden className="size-1.5 rounded-full bg-current" />
                        This device
                      </Badge>
                    ) : null
                  }
                  meta={signedIn ? `Signed in ${signedIn}` : "Signed in earlier"}
                  actions={
                    current ? null : (
                      <PendingButton
                        variant="outline"
                        className={DANGER_OUTLINE}
                        disabled={signingOutOthers}
                        onClick={() => onSignOut(session)}
                      >
                        Sign out
                      </PendingButton>
                    )
                  }
                />
              );
            })}
          </ul>
          {others === 0 ? (
            <p className="px-5 py-3.5 text-sm text-muted-foreground">No other devices are signed in.</p>
          ) : null}
        </RowList>
      )}
    </Section>
  );
}
