"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GuestContact } from "@/lib/reservations/shape";

/**
 * Where "Why?" leads. TBD: point this at the privacy explainer once it
 * is written.
 */
export const BREAK_GLASS_LEARN_MORE_URL = "https://docs.openbookings.co/privacy/break-the-glass";

const timeLabel = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * The guest's phone and address, sealed until someone asks for them. While
 * sealed there is nothing to hide: the details are not on the page at all,
 * only fetched from the server when the seal is broken (and that is logged).
 * Everything else about the booking stays readable around it.
 */
export function GuestContactSeal({
  opened,
  busy,
  error,
  onBreak,
}: {
  /** The details and when they were opened, or null while sealed. */
  opened: { contact: GuestContact; at: Date } | null;
  busy: boolean;
  error: string | null;
  onBreak: () => void;
}) {
  if (opened) return <OpenedContact contact={opened.contact} at={opened.at} />;

  return (
    <div
      role="group"
      aria-labelledby="guest-contact-sealed"
      className="mt-1 grid gap-3 rounded-lg border border-dashed border-input bg-muted p-3.5 sm:grid-cols-[1fr_auto] sm:items-center"
    >
      <span id="guest-contact-sealed" className="sr-only">
        Guest contact details, hidden
      </span>
      <div aria-hidden className="flex flex-col gap-2.5">
        <MaskedRow label="Phone" width="w-32" />
        <MaskedRow label="Address" width="w-44" />
      </div>
      <Button variant="outline" size="sm" onClick={onBreak} disabled={busy}>
        {busy ? <Spinner /> : <LockKeyhole />} Show contact details
      </Button>
      <p className="flex gap-2 border-t pt-2.5 text-xs text-muted-foreground sm:col-span-2">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          Only open these when you need to reach the guest. Each view is logged with your name.{" "}
          <a
            href={BREAK_GLASS_LEARN_MORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Why?
          </a>
        </span>
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive sm:col-span-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MaskedRow({ label, width }: { label: string; width: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-16 text-muted-foreground">{label}</span>
      <span
        className={`h-2 rounded-sm ${width} bg-[repeating-linear-gradient(90deg,var(--gray-6)_0_6px,transparent_6px_9px)]`}
      />
    </div>
  );
}

function OpenedContact({ contact, at }: { contact: GuestContact; at: Date }) {
  const nothingShared = !contact.phone && !contact.address;
  return (
    <>
      {contact.phone ? (
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-muted-foreground">Phone</span>
          <a
            href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
            className="text-sm font-medium tabular-nums underline-offset-2 hover:underline"
          >
            {contact.phone}
          </a>
        </div>
      ) : null}
      {contact.address ? (
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-muted-foreground">Address</span>
          <address className="text-right text-sm font-medium not-italic">
            {contact.address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        </div>
      ) : null}
      {nothingShared ? (
        <p className="text-sm text-muted-foreground">The guest didn&apos;t share a phone number or address.</p>
      ) : null}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-(--amber-11)" />
        Opened by you at {timeLabel.format(at)} and logged. Hidden again when you close the panel.
      </p>
    </>
  );
}
