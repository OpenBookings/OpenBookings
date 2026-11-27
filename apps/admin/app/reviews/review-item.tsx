"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ReviewRuleId } from "@openbookings/pricing";
import { DangerousDialog } from "@/components/dangerous-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminKeepItem, adminRemoveItem } from "@/lib/moderation-actions";
import { RULE_OPTIONS, type ItemView, type Rule, type Segment, type Tone } from "@/lib/moderation-view";
import { cn } from "@/lib/utils";

const TONE: Record<Tone, string> = {
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-900",
  grey: "bg-muted text-foreground/80",
  blue: "bg-blue-100 text-blue-900",
  green: "bg-emerald-100 text-emerald-900",
};

function Chip({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs font-semibold",
        muted ? "border-border bg-muted text-muted-foreground" : "border-red-300 bg-red-50 text-red-800",
      )}
    >
      {children}
    </span>
  );
}

function Words({ segments }: { segments: Segment[] }) {
  return (
    <p className="max-w-[70ch] leading-relaxed whitespace-pre-line">
      {segments.map((s, i) =>
        s.flagged ? (
          <mark key={i} className="rounded-sm bg-amber-200 px-0.5 text-foreground">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

function RuleChips({ rules, otherReasons = [], foundBy }: { rules: Rule[]; otherReasons?: string[]; foundBy?: string | null }) {
  if (rules.length + otherReasons.length === 0 && !foundBy) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {rules.map((r) => (
        <Chip key={r.id}>{r.title}</Chip>
      ))}
      {otherReasons.map((r) => (
        <Chip key={r} muted>
          {r}
        </Chip>
      ))}
      {foundBy ? <span className="self-center text-xs text-muted-foreground">{foundBy}</span> : null}
    </div>
  );
}

/**
 * One review or reply in the moderation queue. Keep publishes it as written
 * (not dangerous: no dialog). Remove asks for the rules it broke, a note to
 * its author and a reason, then a step-up of its own.
 */
export function ReviewItem({ view }: { view: ItemView }) {
  const [error, setError] = useState<string | null>(null);
  const [keeping, startKeep] = useTransition();
  const [removing, setRemoving] = useState(false);
  const [rules, setRules] = useState<ReviewRuleId[]>(view.actions?.remove.preselected ?? []);
  const [note, setNote] = useState("");

  const actions = view.actions;
  const ruleTitles = RULE_OPTIONS.filter((r) => rules.includes(r.id)).map((r) => r.title);

  const keep = () =>
    startKeep(async () => {
      setError(null);
      const result = await adminKeepItem(view.item, view.version);
      if (!result.ok) setError(result.error);
    });

  return (
    <article className={cn("flex flex-col rounded-lg border", view.badge?.tone === "grey" && "border-dashed")}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3.5">
        <span className="font-semibold">{view.kindLabel}</span>
        <span className="text-muted-foreground">
          {view.context.before}
          <Link href={`/bookings/${view.bookingId}`} className="font-mono underline">
            {view.bookingRef}
          </Link>
          {view.context.after}
        </span>
        {view.badge ? (
          <span className={cn("ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[view.badge.tone])}>
            {view.badge.text}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 px-4 py-3.5">
        {view.explanation ? <p className="text-sm text-muted-foreground">{view.explanation}</p> : null}
        <RuleChips rules={view.rules} otherReasons={view.otherReasons} foundBy={view.foundBy} />

        {view.decision ? (
          <div className="grid gap-1.5 text-sm">
            <RuleChips rules={view.decision.rules} />
            {view.decision.note ? <p>Note to the author: &ldquo;{view.decision.note}&rdquo;</p> : null}
            <p className="text-xs text-muted-foreground">
              {view.decision.label} by {view.decision.byline}
            </p>
          </div>
        ) : null}

        {view.text === null ? (
          <p className="text-sm text-muted-foreground italic">The text was deleted 12 months after the decision.</p>
        ) : view.liveText !== null ? (
          <>
            <p className="max-w-[70ch] leading-relaxed whitespace-pre-line">{view.liveText}</p>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">As written</summary>
              <div className="mt-2">
                <Words segments={view.text} />
              </div>
            </details>
          </>
        ) : (
          <Words segments={view.text} />
        )}

        {view.reports.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {view.reports.map((r, i) => (
              <li key={i}>
                <strong>{r.who}</strong> reported it as <em>{r.rule}</em>
                {r.note ? <>: &ldquo;{r.note}&rdquo;</> : null}
                {r.extra ? <span className="text-muted-foreground"> ({r.extra})</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground/70">{view.footnote}</span>
          {actions ? (
            <span className="ml-auto flex gap-2">
              <Button variant="outline" onClick={keep} disabled={keeping}>
                {actions.keepLabel}
              </Button>
              <Button
                variant="destructive"
                disabled={keeping}
                onClick={() => {
                  setError(null);
                  setRemoving(true);
                }}
              >
                {actions.removeLabel}
              </Button>
            </span>
          ) : null}
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {removing && actions ? (
        <DangerousDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(false);
          }}
          action="review.remove"
          targetId={view.item.id}
          summary={actions.remove.summary}
          form={{
            title: actions.remove.title,
            ready: rules.length > 0,
            continueLabel: view.item.kind === "review" ? "Remove review" : "Remove reply",
            fields: (
              <>
                <fieldset className="grid gap-2">
                  <legend className="mb-1.5 text-sm font-semibold">Which rules did it break?</legend>
                  {RULE_OPTIONS.map((r) => (
                    <div key={r.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`rule-${view.key}-${r.id}`}
                        checked={rules.includes(r.id)}
                        onCheckedChange={(checked) =>
                          setRules((now) => (checked === true ? [...now, r.id] : now.filter((id) => id !== r.id)))
                        }
                      />
                      <Label htmlFor={`rule-${view.key}-${r.id}`} className="font-normal">
                        {r.title}
                      </Label>
                    </div>
                  ))}
                  {rules.length === 0 ? <p className="text-xs text-muted-foreground">Pick at least one.</p> : null}
                </fieldset>
                <div className="grid gap-2">
                  <Label htmlFor={`note-${view.key}`}>
                    {actions.remove.noteLabel}{" "}
                    <span className="font-normal text-muted-foreground">({actions.remove.noteHint})</span>
                  </Label>
                  <Textarea id={`note-${view.key}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
                </div>
              </>
            ),
          }}
          stepUpSummary={`${actions.remove.removing} for: ${ruleTitles.join(", ")}.`}
          confirmLabel="Confirm and remove"
          onConfirm={async (reason, stepUpToken) => {
            const answer = await adminRemoveItem(
              { item: view.item, version: view.version, rules, note: note.trim() || null },
              { reason, stepUpToken },
            );
            if (!answer.ok) return answer.message;
            // Refused by the item's own state (decided, changed, gone): shown on the card.
            if (!answer.value.ok) setError(answer.value.error);
            return null;
          }}
        />
      ) : null}
    </article>
  );
}
