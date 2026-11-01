"use client";

import * as React from "react";
import { useState } from "react";
import Link from "next/link";
import { Cookie, Download, ShieldCheck, Trash2 } from "lucide-react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { useCookieConsent } from "@openbookings/analytics/client";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth-client";
import { DANGER_OUTLINE, PendingButton } from "../../_components/pending-button";
import { Row, RowList, Section } from "../../_components/section";
import { AccountDialog, useAction, type ActionResult } from "../../security/_components/passkey-dialogs";
import { checkCanDeleteAccount } from "../_lib/actions";

function CookiePreferences() {
  const { consent, loaded, accept, decline } = useCookieConsent();
  const on = consent === "accepted";
  const status = !loaded ? "Checking…" : consent === null ? "Off until you choose." : on ? "On" : "Off";

  return (
    <Section
      id="privacy-cookies"
      title="Cookie preferences"
      helper="Applies to this browser. Each device remembers its own choice."
      footnote={
        <>
          What each cookie does is in the{" "}
          <Link href="/legal/en/privacy#cookies" className="underline underline-offset-2 hover:text-foreground">
            privacy policy
          </Link>
          .
        </>
      }
    >
      <RowList>
        <ul className="divide-y">
          <Row
            icon={<ShieldCheck aria-hidden className="size-5" />}
            name="Essential"
            meta="Keep you signed in and remember this choice. Always on."
            actions={<Switch checked disabled aria-label="Essential cookies, always on" />}
          />
          <Row
            icon={<Cookie aria-hidden className="size-5" />}
            name="Analytics"
            meta={`PostHog usage statistics and session recordings, with text masked. ${status}`}
            actions={
              <Switch
                checked={on}
                disabled={!loaded}
                aria-label="Analytics cookies"
                onCheckedChange={(next) => {
                  if (next) accept();
                  else decline();
                  toast.success(next ? "Analytics cookies on" : "Analytics cookies off");
                }}
              />
            }
          />
        </ul>
      </RowList>
    </Section>
  );
}

function DownloadData() {
  const [pending, setPending] = useState(false);

  const download = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/account/export", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? "Could not prepare your data. Try again.");
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "openbookings-data.json";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      posthog.capture("account_data_downloaded");
    } catch {
      toast.error("Could not prepare your data. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Section id="privacy-download" title="Download my data" helper="A copy of everything we hold about you, as a JSON file.">
      <RowList>
        <ul>
          <Row
            icon={<Download aria-hidden className="size-5" />}
            name="Your data"
            meta="Account, contact details, bookings, messages, sign-ins and consent records."
            actions={
              <PendingButton variant="outline" pending={pending} onClick={() => void download()}>
                Download
              </PendingButton>
            }
          />
        </ul>
      </RowList>
    </Section>
  );
}

function DeleteConfirm({ email, onClose }: { email: string; onClose: () => void }) {
  const [sent, setSent] = useState(false);
  const { pending, error, start } = useAction(async (): Promise<ActionResult> => {
    const check = await checkCanDeleteAccount();
    if (!check.ok) return { ok: false, error: check.message };
    try {
      const result = await authClient.deleteUser({ callbackURL: "/?account=deleted" });
      if (result.error) return { ok: false, error: "Could not start the deletion. Try again." };
      posthog.capture("account_deletion_requested");
      setSent(true);
      return { ok: false };
    } catch {
      return { ok: false, error: "Could not start the deletion. Check your connection and try again." };
    }
  }, onClose);

  if (sent) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Check your inbox</DialogTitle>
          <DialogDescription>
            We sent a link to {email}. Open it in this browser, while you&apos;re signed in, within an hour. Your account
            is deleted when you open it.
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
    <>
      <DialogHeader>
        <DialogTitle>Delete your account?</DialogTitle>
        <DialogDescription>
          Your profile, contact details, passkeys and sign-ins are removed. Booking records stay for seven years, as Dutch
          tax law requires, without your name or email. This can&apos;t be undone.
        </DialogDescription>
      </DialogHeader>
      <p aria-live="polite" className="text-[13px] text-(--red-11) empty:hidden">
        {error}
      </p>
      <DialogFooter>
        <PendingButton variant="outline" onClick={onClose}>
          Cancel
        </PendingButton>
        <PendingButton variant="outline" className={DANGER_OUTLINE} pending={pending} onClick={() => void start()}>
          Email me a confirmation link
        </PendingButton>
      </DialogFooter>
    </>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Section id="privacy-delete" title="Delete account" helper="Close your OpenBookings account for good.">
      <RowList>
        <ul>
          <Row
            icon={<Trash2 aria-hidden className="size-5" />}
            name="Delete your account"
            meta="You can do this once you have no stays coming up."
            actions={
              <PendingButton variant="outline" className={DANGER_OUTLINE} onClick={() => setOpen(true)}>
                Delete account
              </PendingButton>
            }
          />
        </ul>
      </RowList>
      <AccountDialog open={open} onClose={() => setOpen(false)}>
        <DeleteConfirm email={email} onClose={() => setOpen(false)} />
      </AccountDialog>
    </Section>
  );
}

export function PrivacyPanel({ email }: { email: string }) {
  return (
    <>
      <CookiePreferences />
      <DownloadData />
      <DeleteAccount email={email} />
    </>
  );
}
