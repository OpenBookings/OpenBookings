"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminResolvePaymentFlag } from "@/lib/flagged-payments-actions";
import { formatCents } from "@openbookings/pricing/money";

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

/**
 * Marks a flag as explained by the host. Writes an audit row; nothing is sent
 * to anyone. When the money is on a booking (`recordCents`), staff can enter
 * the host's split into room price and tourist tax, which must add up to it.
 */
export function ResolveForm({ flagId, recordCents }: { flagId: string; recordCents: number | null }) {
  const [note, setNote] = useState("");
  const [roomPrice, setRoomPrice] = useState("");
  const [touristTax, setTouristTax] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          try {
            const result = await adminResolvePaymentFlag({ flagId, note, roomPrice, touristTax });
            if (!result.ok) setError(FAILURES[result.error]);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
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
        <Button size="sm" variant="outline" type="submit" disabled={pending}>
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
  );
}
