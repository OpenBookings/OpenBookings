"use client";

import { Hammer } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { GuestContact } from "@/lib/reservations/shape";

const timeLabel = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * The guest's phone and address behind frosted glass, until someone breaks
 * it. What sits under the frost is a stand-in, not the guest's details:
 * those are only fetched from the server when the glass is broken (and that
 * is logged). Everything else about the booking stays readable around it.
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
    <>
      <div className="relative overflow-hidden rounded-md">
        {/* Out of reach: not focusable, not read out, not selectable. */}
        <div inert aria-hidden className="pointer-events-none flex flex-col gap-3 py-1 blur-[6px] select-none">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted-foreground">Phone</span>
            <span className="text-sm font-medium">+00 0 00 00 00 00</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted-foreground">Address</span>
            <span className="text-right text-sm font-medium">
              <span className="block">Street name 00</span>
              <span className="block">0000 AA City</span>
              <span className="block">Country</span>
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onBreak}
          disabled={busy}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/40 px-4 text-center transition-colors hover:bg-background/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-wait"
        >
          {busy ? <Spinner className="size-5" /> : <Hammer className="size-5" aria-hidden />}
          <span className="text-xs text-muted-foreground">
            Break the glass to see phone and address. Each view is logged.
          </span>
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </>
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
