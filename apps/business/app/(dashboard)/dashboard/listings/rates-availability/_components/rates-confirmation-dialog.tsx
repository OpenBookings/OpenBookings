"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { RATES_TAX_INCLUSIVE_STATEMENT } from "@openbookings/authz/rates-doc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { confirmInclusiveRates } from "../_lib/actions";

/**
 * Asks the organisation to confirm, once and on record, that its rates include
 * tax. Until it has, the server refuses every price change — this dialog is
 * how that gets resolved, not the thing enforcing it.
 *
 * Only an owner or admin can confirm, because it speaks for the organisation.
 * Anyone else is shown the same statement and told who to ask.
 */
export function RatesConfirmationDialog({
  open,
  propertyId,
  canConfirm,
  hasOrganisation,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  propertyId: string;
  canConfirm: boolean;
  /** False for a property not yet attached to an organisation: nobody can confirm. */
  hasOrganisation: boolean;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [checked, setChecked] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const confirm = async () => {
    if (!checked || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await confirmInclusiveRates(propertyId);
      if (result.ok) onConfirmed();
      else setError(result.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your rates include tax</DialogTitle>
          <DialogDescription>
            Guests see the price you enter as the total they pay. OpenBookings
            does not add tourist tax or anything else on top, so the rate has to
            already include it.
          </DialogDescription>
        </DialogHeader>

        <blockquote className="border-l-2 pl-3 text-sm">
          {RATES_TAX_INCLUSIVE_STATEMENT}
        </blockquote>

        {canConfirm ? (
          <div className="flex items-start gap-2">
            <Checkbox
              id="rates-inclusive-confirm"
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            <Label htmlFor="rates-inclusive-confirm" className="font-normal leading-snug">
              I confirm this on behalf of my organisation.
            </Label>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {hasOrganisation
              ? "Prices cannot be changed until this is confirmed. Ask an owner or admin of your organisation to confirm it."
              : "Prices cannot be changed until this is confirmed, and this property is not linked to an organisation yet, so nobody can confirm it. Please contact OpenBookings support."}
          </p>
        )}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {canConfirm ? "Not now" : "Close"}
          </Button>
          {canConfirm ? (
            <Button onClick={confirm} disabled={!checked || pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
