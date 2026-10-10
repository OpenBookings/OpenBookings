"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DANGER_OUTLINE, PendingButton } from "./pending-button";

/** Longest label a passkey can be given on this page. */
export const PASSKEY_NAME_MAX = 40;

const SUGGESTIONS = ["iPhone", "Security key", "Work laptop"];

/**
 * What a dialog's action came to. Not ok without an error means nothing
 * happened and nothing needs saying: the host dismissed a prompt.
 */
export type ActionResult = { ok: true } | { ok: false; error?: string };

function Shell({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className="gap-5 rounded-2xl bg-card p-7 sm:max-w-[460px]">
        {/* Mounted only while open, so nothing typed survives into the next one. */}
        {open ? children : null}
      </DialogContent>
    </Dialog>
  );
}

/** Runs the dialog's action, holding the button busy and keeping any error. */
function useAction(run: () => Promise<ActionResult>, onDone: () => void) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const start = async () => {
    setPending(true);
    setError(null);
    const result = await run();
    setPending(false);
    if (result.ok) onDone();
    else setError(result.error ?? null);
  };
  return { pending, error, start };
}

export function PasskeyNameDialog({
  open,
  mode,
  initialName = "",
  email,
  onSubmit,
  onClose,
}: {
  open: boolean;
  mode: "add" | "rename";
  initialName?: string;
  email?: string | null;
  onSubmit: (name: string) => Promise<ActionResult>;
  onClose: () => void;
}) {
  return (
    <Shell open={open} onClose={onClose}>
      <NameForm mode={mode} initialName={initialName} email={email} onSubmit={onSubmit} onClose={onClose} />
    </Shell>
  );
}

function NameForm({
  mode,
  initialName,
  email,
  onSubmit,
  onClose,
}: {
  mode: "add" | "rename";
  initialName: string;
  email?: string | null;
  onSubmit: (name: string) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(initialName);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { pending, error, start } = useAction(() => onSubmit(name.trim()), onClose);
  const adding = mode === "add";

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <DialogHeader>
        <DialogTitle>{adding ? "Add a passkey" : "Rename passkey"}</DialogTitle>
        <DialogDescription>
          Give it a name so you can tell your passkeys apart later.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="passkey-name">Name</Label>
        <Input
          ref={inputRef}
          id="passkey-name"
          autoFocus
          autoComplete="off"
          className="h-11 bg-background dark:bg-background"
          placeholder="e.g. iPhone, YubiKey"
          maxLength={PASSKEY_NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby="passkey-name-help"
          aria-invalid={error ? true : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="h-8 rounded-full border border-input px-3 text-xs font-medium text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => {
                setName(suggestion);
                inputRef.current?.focus();
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
        <p id="passkey-name-help" className="text-[13px] text-muted-foreground">
          Only shown here. On your device the passkey is saved under {email || "your email address"}.
        </p>
        <p aria-live="polite" className="text-[13px] text-(--red-11) empty:hidden">
          {error}
        </p>
      </div>

      {adding ? (
        <p className="rounded-[10px] border bg-background px-3.5 py-3 text-[13px] text-muted-foreground">
          Next, your browser will ask you to confirm with Touch ID, your phone, or a security key.
        </p>
      ) : null}

      <DialogFooter>
        <PendingButton type="button" variant="outline" onClick={onClose}>
          Cancel
        </PendingButton>
        <PendingButton type="submit" pending={pending} disabled={!adding && !name.trim()}>
          {adding ? "Continue" : "Save"}
        </PendingButton>
      </DialogFooter>
    </form>
  );
}

export function RemovePasskeyDialog({
  open,
  name,
  onConfirm,
  onClose,
}: {
  open: boolean;
  name: string;
  onConfirm: () => Promise<ActionResult>;
  onClose: () => void;
}) {
  return (
    <Shell open={open} onClose={onClose}>
      <RemoveBody name={name} onConfirm={onConfirm} onClose={onClose} />
    </Shell>
  );
}

function RemoveBody({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: () => Promise<ActionResult>;
  onClose: () => void;
}) {
  const { pending, error, start } = useAction(onConfirm, onClose);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="leading-snug break-words">Remove {name}?</DialogTitle>
        <DialogDescription>You will no longer be able to sign in with this passkey.</DialogDescription>
      </DialogHeader>
      <p aria-live="polite" className="text-[13px] text-(--red-11) empty:hidden">
        {error}
      </p>
      <DialogFooter>
        <PendingButton variant="outline" onClick={onClose}>
          Cancel
        </PendingButton>
        <PendingButton variant="outline" className={DANGER_OUTLINE} pending={pending} onClick={() => void start()}>
          Remove
        </PendingButton>
      </DialogFooter>
    </>
  );
}

export function LastPasskeyDialog({
  open,
  name,
  onAddAnother,
  onClose,
}: {
  open: boolean;
  name: string;
  onAddAnother: () => void;
  onClose: () => void;
}) {
  return (
    <Shell open={open} onClose={onClose}>
      <DialogHeader>
        <span className="mb-2 flex size-10 items-center justify-center rounded-[10px] bg-(--amber-3) text-(--amber-11) max-sm:mx-auto">
          <TriangleAlert aria-hidden className="size-5" />
        </span>
        <DialogTitle>Add another passkey first</DialogTitle>
        <DialogDescription className="break-words">
          {name} is your only passkey. Removing it would leave your account without one, so we
          keep it until you have added another one.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <PendingButton variant="outline" onClick={onClose}>
          Cancel
        </PendingButton>
        <PendingButton autoFocus onClick={onAddAnother}>
          Add another passkey
        </PendingButton>
      </DialogFooter>
    </Shell>
  );
}
