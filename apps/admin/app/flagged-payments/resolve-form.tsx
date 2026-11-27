"use client";

import { useState } from "react";
import { DangerousDialog } from "@/components/dangerous-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminResolvePaymentFlag } from "@/lib/flagged-payments-actions";
import { formatCents, parseEuroInput } from "@openbookings/pricing/money";

const FAILURES = {
  invalid: "Not a flag id",
  not_found: "Flag not found",
  already_resolved: "Already resolved",
  no_booking_record: "No booking record to split: resolve without amounts",
  split_not_an_amount: "Room price and tourist tax must be amounts in euros",
  split_not_whole_cents: "Room price and tourist tax must be whole cents",
  split_negative: "Room price and tourist tax can't be negative",
  split_sum_mismatch: "Room price and tourist tax must add up to the amount on the booking",
} as const;

const euro = (cents: number) => formatCents(cents, { whole: "always-decimals" });

/** Cents typed as euros; "" is €0 (as the server reads it); null when it is not an amount. */
const typedCents = (typed: string): number | null => {
  if (typed.trim() === "") return 0;
  const parsed = parseEuroInput(typed.trim());
  return parsed.ok ? parsed.cents : null;
};

/**
 * Marks a flag as explained by the host. Writes an audit row; nothing is sent
 * to anyone. When the money is on a booking (`recordCents`), staff can enter
 * the host's split into room price and tourist tax, which must add up to it.
 * Dangerous: it asks for a reason and a step-up first.
 */
export function ResolveForm({
  flagId,
  recordCents,
  what,
}: {
  flagId: string;
  recordCents: number | null;
  /** The flag as the summary names it, e.g. "the €80.00 refund outside OpenBookings on OB-B7B0-2A1C (Hotel Aurora)". */
  what: string;
}) {
  const [note, setNote] = useState("");
  const [roomPrice, setRoomPrice] = useState("");
  const [touristTax, setTouristTax] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const split = roomPrice.trim() !== "" || touristTax.trim() !== "";

  /** What resolving records, from what staff typed; null (with an error shown) when it can't. */
  function describe(): string | null {
    if (!split) {
      const kept = recordCents === null ? "" : ` The booking keeps counting all ${euro(recordCents)} as room price.`;
      return `Resolve ${what}.${kept} Nobody is emailed. This can't be undone.`;
    }
    const room = typedCents(roomPrice);
    const tax = typedCents(touristTax);
    if (room === null || tax === null) {
      setError(FAILURES.split_not_an_amount);
      return null;
    }
    if (recordCents === null) {
      setError(FAILURES.no_booking_record);
      return null;
    }
    if (room + tax !== recordCents) {
      setError(FAILURES.split_sum_mismatch);
      return null;
    }
    return `Resolve ${what}, and record ${euro(room)} of it as room price and ${euro(tax)} as tourist tax. Nobody is emailed. This can't be undone.`;
  }

  return (
    <>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setSummary(describe());
        }}
      >
        <div className="flex items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Host's explanation (optional)"
            className="h-8 w-56"
            aria-label="Resolution note"
          />
          <Button size="sm" variant="outline" type="submit">
            Resolve
          </Button>
        </div>
        {recordCents !== null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Of {euro(recordCents)}:</span>
            <Input
              value={roomPrice}
              onChange={(e) => setRoomPrice(e.target.value)}
              placeholder="Room price €"
              inputMode="decimal"
              className="h-8 w-28"
              aria-label="Room price, euros"
            />
            <Input
              value={touristTax}
              onChange={(e) => setTouristTax(e.target.value)}
              placeholder="Tourist tax €"
              inputMode="decimal"
              className="h-8 w-28"
              aria-label="Tourist tax, euros"
            />
            <span>optional</span>
          </div>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </form>
      {summary ? (
        <DangerousDialog
          open
          onOpenChange={(open) => {
            if (!open) setSummary(null);
          }}
          action="payment_flag.resolve"
          targetId={flagId}
          summary={summary}
          onConfirm={async (reason, stepUpToken) => {
            const answer = await adminResolvePaymentFlag(
              { flagId, note, roomPrice, touristTax },
              { reason, stepUpToken },
            );
            if (!answer.ok) return answer.message;
            // Refused by the flag's own rules (already resolved, a split that doesn't add up): shown under the form.
            if (!answer.value.ok) setError(FAILURES[answer.value.error]);
            return null;
          }}
        />
      ) : null}
    </>
  );
}
