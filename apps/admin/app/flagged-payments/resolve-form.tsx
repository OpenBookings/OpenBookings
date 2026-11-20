"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminResolvePaymentFlag } from "@/lib/flagged-payments-actions";

const FAILURES = {
  invalid: "Not a flag id",
  not_found: "Flag not found",
  already_resolved: "Already resolved",
} as const;

/** Marks a flag as explained by the host. Writes an audit row; nothing is sent to anyone. */
export function ResolveForm({ flagId }: { flagId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          try {
            const result = await adminResolvePaymentFlag({ flagId, note });
            if (!result.ok) setError(FAILURES[result.error]);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
      }}
    >
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
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
