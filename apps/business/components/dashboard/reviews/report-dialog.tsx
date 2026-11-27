"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  REVIEW_RULE_IDS,
  REVIEW_RULES,
  type ReviewRuleId,
} from "@openbookings/pricing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { reportGuestAnswer, reportReview } from "@/lib/reviews/actions";

const NOTE_MAX = 1000;
const RULES_PAGE = `${process.env.NEXT_PUBLIC_WEB_URL ?? "https://openbookings.co"}/legal/review-rules`;

/**
 * Report a review, or a guest's answer, against one rule, with an optional
 * note. A person at OpenBookings decides; it stays on the page meanwhile.
 */
export function ReportDialog({
  target,
  open,
  onOpenChange,
}: {
  /** A review, or a guest's answer under one. */
  target: { kind: "review" | "answer"; id: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rule, setRule] = React.useState<ReviewRuleId | "">("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, startTransition] = React.useTransition();

  const send = () =>
    startTransition(async () => {
      setError(null);
      const input = { rule, note };
      const result = target.kind === "review" ? await reportReview(target.id, input) : await reportGuestAnswer(target.id, input);
      if (!result.ok) return setError(result.message);
      toast.success("Reported. We'll email you the outcome.");
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{target.kind === "review" ? "Report this review" : "Report this answer"}</DialogTitle>
          <DialogDescription>
            A person at OpenBookings checks it against our{" "}
            <a
              href={RULES_PAGE}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              review rules
            </a>
            . It stays on your page while we check. You can&apos;t remove
            reviews yourself, and a low score alone isn&apos;t a reason.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-2.5">
          <legend className="mb-2 text-sm font-semibold">
            Which rule does it break?
          </legend>
          <RadioGroup
            value={rule}
            onValueChange={(v) => setRule(v as ReviewRuleId)}
            className="gap-2.5"
          >
            {REVIEW_RULE_IDS.map((id) => (
              <div key={id} className="flex items-center gap-2">
                <RadioGroupItem id={`report-${target.id}-${id}`} value={id} />
                <Label
                  htmlFor={`report-${target.id}-${id}`}
                  className="font-normal"
                >
                  {REVIEW_RULES[id].title}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor={`report-${target.id}-note`}>
            What should we know?{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Textarea
            id={`report-${target.id}-note`}
            rows={3}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={send} disabled={busy || rule === ""}>
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
