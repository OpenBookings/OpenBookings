import * as React from "react";
import { KeyRound, Laptop } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSecurityTimestamp } from "@/lib/security-timestamp";
import { describeDevice } from "@/lib/device";
import { DANGER_OUTLINE, PendingButton } from "./pending-button";

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

function Section({
  id,
  title,
  helper,
  action,
  headingRef,
  footnote,
  children,
}: {
  id: string;
  title: string;
  helper: string;
  action?: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
  footnote?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={id} ref={headingRef} tabIndex={-1} className="scroll-mt-6 text-base font-semibold outline-none">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{helper}</p>
        </div>
        {action}
      </div>
      {children}
      {footnote ? <p className="text-[13px] text-muted-foreground">{footnote}</p> : null}
    </section>
  );
}

function RowList({ children }: { children: React.ReactNode }) {
  return <Card className="gap-0 divide-y overflow-hidden py-0">{children}</Card>;
}

function Row({
  icon,
  name,
  chip,
  meta,
  actions,
}: {
  icon: React.ReactNode;
  name: string;
  chip?: React.ReactNode;
  meta: string;
  actions?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate" title={name}>
            {name}
          </span>
          {chip}
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{meta}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </li>
  );
}

export function SkeletonRows() {
  return (
    <RowList>
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-10 rounded-[10px]" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>
      ))}
    </RowList>
  );
}

function LoadError({ what, onRetry, retrying }: { what: string; onRetry: () => void; retrying: boolean }) {
  return (
    <Card role="alert" className="flex-row flex-wrap items-center justify-between gap-4 px-5 py-4">
      <p className="text-sm text-muted-foreground">Your {what} could not be loaded.</p>
      <PendingButton variant="outline" pending={retrying} onClick={onRetry}>
        Retry
      </PendingButton>
    </Card>
  );
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
      helper="Sign in and confirm sensitive changes without codes."
      action={
        <PendingButton variant="outline" className="max-sm:w-full" disabled={!ready} onClick={onAdd}>
          Add passkey
        </PendingButton>
      }
      footnote={
        ready && passkeys.length > 0 ? "You cannot remove your last passkey. Add another one first." : null
      }
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
      footnote={ready ? "Do not recognise a session? Sign it out, then remove any passkey you did not add." : null}
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
