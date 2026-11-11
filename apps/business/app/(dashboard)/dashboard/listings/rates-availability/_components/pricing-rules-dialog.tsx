"use client";

import * as React from "react";
import { Loader2, PencilLine, Plus, Trash2 } from "lucide-react";
import { discountLabel } from "@openbookings/pricing";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { deleteRule, saveRule, setRuleActive } from "../_lib/actions";
import type { ModifierResult } from "../_lib/modifier-mutations";
import { RULE_LIMITS, type RuleKind } from "../_lib/modifier-schema";
import { ruleForm, ruleSentence, WEEKDAYS, type PricingRule, type RuleFormValues } from "../_lib/rule-copy";
import type { RatePlanRow } from "../_lib/types";

/**
 * A rate plan's pricing rules: a list that reads as sentences, each with an
 * on/off switch, and an editor for one rule. Saving re-prices the grid and
 * the listing (actions.ts revalidates), so the list below refreshes itself.
 */

const KINDS: { kind: RuleKind; label: string }[] = [
  { kind: "weekend", label: "Days of the week" },
  { kind: "length_of_stay", label: "Length of stay" },
  { kind: "early_bird", label: "Early booking" },
  { kind: "last_minute", label: "Last minute" },
];

/** Only these lower the price whatever is picked; the others go either way. */
const DISCOUNT_KINDS = new Set<RuleKind>(["length_of_stay", "early_bird"]);

type FieldErrors = Record<string, string[] | undefined>;

export function PricingRulesDialog({ plan, roomName }: { plan: RatePlanRow; roomName: string }) {
  const [editing, setEditing] = React.useState<PricingRule | "new" | null>(null);

  if (editing) {
    return (
      <RuleEditor
        ratePlanId={plan.id}
        rule={editing === "new" ? null : editing}
        onDone={() => setEditing(null)}
      />
    );
  }
  return <RuleList plan={plan} roomName={roomName} onEdit={setEditing} />;
}

// ─────────────────────────────────────────────
// List
// ─────────────────────────────────────────────

function RuleList({
  plan,
  roomName,
  onEdit,
}: {
  plan: RatePlanRow;
  roomName: string;
  onEdit: (rule: PricingRule | "new") => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  // Delete asks once more in the row itself; the page can't show confirm().
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const run = async (id: string, action: () => Promise<ModifierResult>) => {
    setBusy(id);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) setError(result.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Pricing rules · {roomName}, {plan.name}
        </DialogTitle>
        <DialogDescription>
          Change the price for some stays: weekdays, long stays, early or last-minute bookings.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 py-4">
        {plan.rules.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
            No rules yet. Every night sells at the base rate or the price you set for it.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {plan.rules.map((rule) => {
              const discount = rule.type === "length_of_stay" || rule.type === "early_bird";
              return (
                <li key={rule.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className={rule.active ? "text-sm" : "text-muted-foreground text-sm"}>{ruleSentence(rule)}</p>
                    {discount && (
                      <p className="text-muted-foreground text-xs">Guests see “{discountLabel({ type: rule.type, trigger_condition: rule.triggerCondition })}”</p>
                    )}
                  </div>
                  {confirming === rule.id ? (
                    <>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={busy === rule.id}
                        onClick={() => void run(rule.id, () => deleteRule(rule.id))}
                      >
                        {busy === rule.id && <Loader2 className="size-4 animate-spin" />}
                        Delete rule
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <>
                      <Switch
                        checked={rule.active}
                        disabled={busy === rule.id}
                        onCheckedChange={(on) => void run(rule.id, () => setRuleActive(rule.id, on))}
                        aria-label={`${rule.active ? "Turn off" : "Turn on"}: ${ruleSentence(rule)}`}
                      />
                      <Button type="button" variant="ghost" size="icon" aria-label="Edit rule" onClick={() => onEdit(rule)}>
                        <PencilLine className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Delete rule"
                        onClick={() => setConfirming(rule.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-muted-foreground bg-muted/50 rounded-lg p-3 text-xs">
          Only one discount applies per booking: the one that saves the guest the most. Surcharges always apply.
        </p>
        {error && (
          <p role="alert" className="text-(--red-9) text-sm">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" onClick={() => onEdit("new")}>
          <Plus className="size-4" />
          Add rule
        </Button>
      </DialogFooter>
    </>
  );
}

// ─────────────────────────────────────────────
// Editor
// ─────────────────────────────────────────────

function RuleEditor({
  ratePlanId,
  rule,
  onDone,
}: {
  ratePlanId: string;
  rule: PricingRule | null;
  onDone: () => void;
}) {
  const [v, setV] = React.useState<RuleFormValues>(() => ruleForm(rule));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const set = (patch: Partial<RuleFormValues>) => setV((prev) => ({ ...prev, ...patch }));

  const isDiscount = DISCOUNT_KINDS.has(v.kind);
  const lowers = isDiscount || v.direction === "down";
  // A fixed amount only raises the price per night; lowering is a percentage.
  const adjustmentType = lowers ? "percent" : v.adjustmentType;
  const fieldError = (name: string) => errors[name]?.[0];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setErrors({});
    try {
      const result = await saveRule({
        ratePlanId,
        ...(rule ? { modifierId: rule.id } : {}),
        ...v,
        direction: lowers ? "down" : "up",
        adjustmentType,
      });
      if (result.ok) return onDone();
      setError(result.error);
      setErrors(result.errors ?? {});
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const limits = RULE_LIMITS[adjustmentType];

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{rule ? "Edit rule" : "Add rule"}</DialogTitle>
        <DialogDescription>
          {isDiscount ? "A discount, as a percentage of the price." : "A surcharge per night, or a lower price, for some stays."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5 py-4">
        <div className="flex flex-col gap-1.5">
          <Label>Rule</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={v.kind}
            onValueChange={(kind) => kind && set({ kind: kind as RuleKind })}
            aria-label="What the rule is for"
            className="flex-wrap"
          >
            {KINDS.map(({ kind, label }) => (
              <ToggleGroupItem key={kind} value={kind}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {v.kind === "weekend" && (
          <div className="flex flex-col gap-1.5">
            <Label>On these nights</Label>
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              value={v.daysOfWeek}
              onValueChange={(days) => set({ daysOfWeek: days })}
              aria-label="Nights of the week"
              className="flex-wrap"
            >
              {WEEKDAYS.map(({ day, short }) => (
                <ToggleGroupItem key={day} value={String(day)}>
                  {short}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldMessage message={fieldError("daysOfWeek")} />
          </div>
        )}
        {v.kind === "length_of_stay" && (
          <NumberField
            id="rule-min-nights"
            label="Stays of at least"
            suffix="nights"
            value={v.minNights}
            min={RULE_LIMITS.minNights.min}
            max={RULE_LIMITS.minNights.max}
            onChange={(minNights) => set({ minNights })}
            error={fieldError("minNights")}
          />
        )}
        {v.kind === "early_bird" && (
          <NumberField
            id="rule-days-before"
            label="Booked at least"
            suffix="days before arrival"
            value={v.daysBeforeArrival}
            min={RULE_LIMITS.daysBeforeArrival.min}
            max={RULE_LIMITS.daysBeforeArrival.max}
            onChange={(daysBeforeArrival) => set({ daysBeforeArrival })}
            error={fieldError("daysBeforeArrival")}
          />
        )}
        {v.kind === "last_minute" && (
          <NumberField
            id="rule-days-till"
            label="Booked within"
            suffix="days of arrival (0 = the day itself)"
            value={v.daysTillArrival}
            min={RULE_LIMITS.daysTillArrival.min}
            max={RULE_LIMITS.daysTillArrival.max}
            onChange={(daysTillArrival) => set({ daysTillArrival })}
            error={fieldError("daysTillArrival")}
          />
        )}

        <div className="flex flex-wrap items-end gap-4">
          {!isDiscount && (
            <div className="flex flex-col gap-1.5">
              <Label>Price</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={v.direction}
                onValueChange={(direction) => direction && set({ direction: direction as "up" | "down" })}
                aria-label="Raise or lower the price"
              >
                <ToggleGroupItem value="up">Raise</ToggleGroupItem>
                <ToggleGroupItem value="down">Lower</ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>{isDiscount ? "Discount" : "By"}</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={adjustmentType}
              onValueChange={(type) => type && set({ adjustmentType: type as "flat" | "percent" })}
              aria-label="A percentage or an amount"
            >
              <ToggleGroupItem value="percent">%</ToggleGroupItem>
              <ToggleGroupItem value="flat" disabled={lowers} title={lowers ? "A discount is a percentage" : undefined}>
                € per night
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <NumberField
            id="rule-amount"
            label="Amount"
            suffix={adjustmentType === "percent" ? "%" : "€"}
            value={v.amount}
            min={limits.min}
            max={limits.max}
            onChange={(amount) => set({ amount })}
            error={fieldError("amount") ?? fieldError("adjustmentType")}
          />
        </div>
        {lowers && (
          <p className="text-muted-foreground text-xs">
            {isDiscount
              ? `Guests see this as “${discountLabel({
                  type: v.kind === "early_bird" ? "early_bird" : "length_of_stay",
                  trigger_condition: { min_nights: Number(v.minNights) || 0 },
                })}”. Lowering the price is always a percentage.`
              : "Lowering the price is always a percentage."}
          </p>
        )}

        {error && (
          <p role="alert" className="text-(--red-9) text-sm">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save rule
        </Button>
      </DialogFooter>
    </form>
  );
}

function NumberField({
  id,
  label,
  suffix,
  value,
  min,
  max,
  onChange,
  error,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className="w-24"
        />
        <span className="text-muted-foreground text-sm">{suffix}</span>
      </div>
      <FieldMessage message={error} />
    </div>
  );
}

function FieldMessage({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-(--red-9) text-xs">{message}</p>;
}
