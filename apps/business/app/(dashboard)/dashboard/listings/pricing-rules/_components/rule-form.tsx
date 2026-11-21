"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { discountLabel, type ModifierType } from "@openbookings/pricing";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { RULE_LIMITS, type RuleKind } from "../../rates-availability/_lib/modifier-schema";
import { ruleForm, WEEKDAYS } from "../../rates-availability/_lib/rule-copy";
import { deleteRuleGroupAction, saveRuleGroupAction } from "../_lib/actions";
import {
  amountLabel,
  plansByRoom,
  PRICING_RULES_PATH,
  sectionOf,
  whenLabel,
  type PlanOption,
  type RuleGroup,
  type RuleSection,
} from "../_lib/rule-model";
import type { RuleGroupForm } from "../_lib/rule-group-schema";

/**
 * Add or edit one pricing rule, on its own page: what kind of rule, its
 * condition and amount, and the rate plans it applies to. On the right, a
 * live summary; for a discount, the discounts it competes with; for a price
 * adjustment, what it does to real prices.
 */

type Values = Omit<RuleGroupForm, "section">;
type FieldErrors = Record<string, string[] | undefined>;

const KIND_OPTIONS: Record<RuleSection, { kind: RuleKind; title: string; hint: string }[]> = {
  discount: [
    { kind: "length_of_stay", title: "Length of stay", hint: "For stays of a minimum number of nights" },
    { kind: "early_bird", title: "Early booking", hint: "For guests who book well before arrival" },
    { kind: "last_minute", title: "Last minute", hint: "For guests who book close to arrival" },
  ],
  adjustment: [
    { kind: "weekend", title: "Days of the week", hint: "A different price on some nights, like weekends" },
    { kind: "last_minute", title: "Last minute", hint: "A higher price for guests who book close to arrival" },
  ],
};

const MODIFIER_TYPE: Record<RuleKind, ModifierType> = {
  weekend: "day_of_week",
  length_of_stay: "length_of_stay",
  early_bird: "early_bird",
  last_minute: "last_minute",
};

function initialValues(section: RuleSection, rule: RuleGroup | null, planId: string | null): Values {
  if (rule) {
    return {
      ...ruleForm({ ...rule }),
      scope: rule.appliesToAll ? "all" : "some",
      ratePlanIds: rule.ratePlanIds,
    };
  }
  const base = ruleForm(null);
  const scope = planId ? { scope: "some" as const, ratePlanIds: [planId] } : { scope: "all" as const, ratePlanIds: [] };
  return section === "discount"
    ? { ...base, kind: "length_of_stay", direction: "down", adjustmentType: "percent", minNights: "7", ...scope }
    : { ...base, kind: "weekend", direction: "up", adjustmentType: "flat", ...scope };
}

export function RuleForm({
  section,
  propertyId,
  plans,
  rules,
  rule,
  planId,
}: {
  section: RuleSection;
  propertyId: string;
  plans: PlanOption[];
  /** Every rule of the property, for "Competes with". */
  rules: RuleGroup[];
  /** The rule being edited; null when adding one. */
  rule: RuleGroup | null;
  /** The rate plan the page was filtered to, preselected for a new rule. */
  planId: string | null;
}) {
  const router = useRouter();
  const [v, setV] = React.useState<Values>(() => initialValues(section, rule, planId));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const set = (patch: Partial<Values>) => setV((prev) => ({ ...prev, ...patch }));
  const fieldError = (name: string) => errors[name]?.[0];

  const isDiscount = section === "discount";
  // A discount lowers the price; a last-minute adjustment raises it.
  const direction = isDiscount ? "down" : v.kind === "last_minute" ? "up" : v.direction;
  const lowers = direction === "down";
  // Lowering the price is always a percentage (0042, 0050).
  const adjustmentType = lowers ? "percent" : v.adjustmentType;
  const limits = RULE_LIMITS[adjustmentType];
  const noun = isDiscount ? "discount" : "price adjustment";
  const backHref = planId ? `${PRICING_RULES_PATH}?plan=${planId}` : PRICING_RULES_PATH;

  const amount = Number(v.amount) || 0;
  const preview: Pick<RuleGroup, "type" | "adjustmentType" | "adjustmentValue" | "triggerCondition"> = {
    type: MODIFIER_TYPE[v.kind],
    adjustmentType,
    adjustmentValue: lowers ? -amount : amount,
    triggerCondition: {
      days_of_week: v.daysOfWeek.map(Number),
      min_nights: Number(v.minNights) || 0,
      days_before_arrival: Number(v.daysBeforeArrival) || 0,
      days_till_arrival: Number(v.daysTillArrival) || 0,
    },
  };
  const chosenPlans = v.scope === "all" ? plans : plans.filter((p) => v.ratePlanIds.includes(p.id));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setErrors({});
    try {
      const result = await saveRuleGroupAction({
        ...v,
        section,
        direction,
        adjustmentType,
        propertyId,
        ...(rule ? { groupId: rule.id } : {}),
      });
      if (result.ok) {
        toast.success(rule ? "Rule saved" : `${isDiscount ? "Discount" : "Price adjustment"} added`);
        router.push(backHref);
        return;
      }
      setError(result.error);
      setErrors(result.errors ?? {});
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 px-4 lg:px-6">
      <PageHeader
        title={rule ? `Edit ${noun}` : `Add ${noun}`}
        description={
          isDiscount
            ? "A stay gets one discount, the biggest it qualifies for."
            : "It changes the price of every night it matches, on the rate plans you pick."
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={backHref}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {`Save ${isDiscount ? "discount" : "adjustment"}`}
            </Button>
          </>
        }
      />

      {error && (
        <p role="alert" className="rounded-lg border border-(--red-7) bg-(--red-3) px-4 py-3 text-(--red-11) text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <Card title="Type">
            <div
              role="radiogroup"
              aria-label={`Kind of ${noun}`}
              className={cn("grid gap-2.5", isDiscount ? "sm:grid-cols-3" : "sm:grid-cols-2")}
            >
              {KIND_OPTIONS[section].map((option) => {
                const selected = v.kind === option.kind;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => set({ kind: option.kind })}
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border p-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                      selected ? "border-primary bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <span className="font-medium text-sm">{option.title}</span>
                    <span className="text-muted-foreground text-xs">{option.hint}</span>
                  </button>
                );
              })}
            </div>
            <FieldMessage message={fieldError("kind")} />
            {!isDiscount && (
              <p className="text-muted-foreground text-xs">
                Want a lower last-minute price?{" "}
                <Link href={`${PRICING_RULES_PATH}/new?section=discount`} className="underline underline-offset-2">
                  Add it as a discount
                </Link>
                , so it never stacks with another one.
              </p>
            )}
          </Card>

          <Card title={isDiscount ? "Discount" : "Adjustment"}>
            {v.kind === "weekend" && (
              <div className="flex flex-col gap-1.5">
                <Label>On these nights</Label>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  value={v.daysOfWeek}
                  onValueChange={(days) => set({ daysOfWeek: days })}
                  aria-label="Nights of the week"
                  className="flex-wrap"
                >
                  {WEEKDAYS.map(({ day, short }) => (
                    <ToggleGroupItem key={day} value={String(day)} className="min-w-12">
                      {short}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <FieldMessage message={fieldError("daysOfWeek")} />
              </div>
            )}

            <div className="flex flex-wrap items-end gap-6">
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
                  label="Booked"
                  suffix="days or less before arrival (0 = on the day)"
                  value={v.daysTillArrival}
                  min={RULE_LIMITS.daysTillArrival.min}
                  max={RULE_LIMITS.daysTillArrival.max}
                  onChange={(daysTillArrival) => set({ daysTillArrival })}
                  error={fieldError("daysTillArrival")}
                />
              )}

              {v.kind === "weekend" && (
                <div className="flex flex-col gap-1.5">
                  <Label>Price</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={v.direction}
                    onValueChange={(next) => next && set({ direction: next as "up" | "down" })}
                    aria-label="Raise or lower the price"
                  >
                    <ToggleGroupItem value="up">Raise</ToggleGroupItem>
                    <ToggleGroupItem value="down">Lower</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}

              {isDiscount ? (
                <NumberField
                  id="rule-amount"
                  label="Discount"
                  suffix="% off the stay"
                  value={v.amount}
                  min={limits.min}
                  max={limits.max}
                  onChange={(next) => set({ amount: next })}
                  error={fieldError("amount") ?? fieldError("adjustmentType")}
                />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rule-amount">By</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="rule-amount"
                      type="number"
                      inputMode="numeric"
                      min={limits.min}
                      max={limits.max}
                      step={1}
                      value={v.amount}
                      onChange={(e) => set({ amount: e.target.value })}
                      aria-invalid={!!(fieldError("amount") ?? fieldError("adjustmentType"))}
                      className="w-24"
                    />
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={adjustmentType}
                      onValueChange={(next) => next && set({ adjustmentType: next as "flat" | "percent" })}
                      aria-label="A percentage or an amount per night"
                    >
                      <ToggleGroupItem value="percent">%</ToggleGroupItem>
                      <ToggleGroupItem value="flat" disabled={lowers} title={lowers ? "A lower price is a percentage" : undefined}>
                        € per night
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <FieldMessage message={fieldError("amount") ?? fieldError("adjustmentType")} />
                </div>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {isDiscount
                ? "Taken off the room price after price adjustments. Extra guests are never discounted."
                : "A lower price is a percentage. A fixed amount only raises the price."}
            </p>
          </Card>

          <Card title="Rate plans">
            <div role="radiogroup" aria-label="Rate plans" className="flex flex-col gap-3">
            <ScopeOption
              selected={v.scope === "all"}
              onSelect={() => set({ scope: "all" })}
              title="All rate plans"
              hint="Including rate plans you add later."
            />
            <ScopeOption
              selected={v.scope === "some"}
              onSelect={() => set({ scope: "some" })}
              title="Choose rate plans"
            >
              {v.scope === "some" && (
                <div className="grid gap-x-6 gap-y-3 pl-7 sm:grid-cols-2">
                  {plansByRoom(plans).map((room) => (
                    <fieldset key={room.roomId} className="flex flex-col gap-2">
                      <legend className="mb-1 font-medium text-muted-foreground text-xs">{room.roomName}</legend>
                      {room.plans.map((plan) => {
                        const checked = v.ratePlanIds.includes(plan.id);
                        return (
                          <Label key={plan.id} className="flex items-center gap-2.5 font-normal">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(on) =>
                                set({
                                  ratePlanIds: on
                                    ? [...v.ratePlanIds, plan.id]
                                    : v.ratePlanIds.filter((id) => id !== plan.id),
                                })
                              }
                            />
                            {plan.name}
                          </Label>
                        );
                      })}
                    </fieldset>
                  ))}
                </div>
              )}
            </ScopeOption>
            </div>
            <FieldMessage message={fieldError("ratePlanIds")} />
          </Card>

          {rule && <DeleteRule groupId={rule.id} noun={noun} backHref={backHref} />}
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <Card title="Summary">
            {isDiscount ? (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">At checkout guests see</span>
                <span className="font-semibold text-(--green-11) text-lg">
                  {discountLabel({ type: preview.type, trigger_condition: preview.triggerCondition })}{" "}
                  {amount > 0 ? `−${amount}%` : ""}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">Price adjustment</span>
                <span className="font-semibold text-lg">
                  {amount > 0 ? `${amountLabel(preview)}${adjustmentType === "flat" ? " per night" : ""}` : "—"}{" "}
                  <span className="font-normal text-muted-foreground text-sm">{whenLabel(preview)}</span>
                </span>
              </div>
            )}
            <ul className="flex flex-col gap-1.5 text-sm">
              <li>{isDiscount ? "One per stay: the biggest a stay qualifies for wins" : "Always applies, also when a discount does"}</li>
              <li>
                {v.scope === "all"
                  ? "All rate plans, including new ones"
                  : `${chosenPlans.length} ${chosenPlans.length === 1 ? "rate plan" : "rate plans"}`}
              </li>
              {!isDiscount && <li>Guests see the night&apos;s price, not a separate line</li>}
            </ul>
          </Card>

          {isDiscount ? (
            <CompetesWith rules={rules} current={rule} planIds={v.scope === "all" ? null : v.ratePlanIds} />
          ) : (
            <PriceExamples plans={chosenPlans} preview={preview} />
          )}
        </aside>
      </div>
    </form>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5 rounded-xl border bg-card p-5">
      <SectionHeader title={title} />
      {children}
    </section>
  );
}

function ScopeOption({
  selected,
  onSelect,
  title,
  hint,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border p-3", selected && "border-primary")}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex items-start gap-2.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50",
          )}
        >
          {selected && <Check className="size-2.5" strokeWidth={4} />}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-sm">{title}</span>
          {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
        </span>
      </button>
      {children}
    </div>
  );
}

function CompetesWith({
  rules,
  current,
  planIds,
}: {
  rules: RuleGroup[];
  current: RuleGroup | null;
  /** The plans this discount is on; null for all of them. */
  planIds: string[] | null;
}) {
  const overlaps = (other: RuleGroup) =>
    planIds === null || other.appliesToAll || other.ratePlanIds.some((id) => planIds.includes(id));
  const others = rules.filter((r) => r.id !== current?.id && sectionOf(r) === "discount" && overlaps(r));
  return (
    <Card title="Competes with">
      {others.length === 0 ? (
        <p className="text-muted-foreground text-sm">No other discounts on these rate plans. This one always applies when a stay qualifies.</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            A stay gets one discount: the biggest it qualifies for. On these rate plans this discount competes with:
          </p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {others.map((other) => (
              <li key={other.id} className="flex justify-between gap-3">
                <span>{`${discountLabel({ type: other.type, trigger_condition: other.triggerCondition })} ${amountLabel(other)}`}</span>
                <span className="text-muted-foreground">{other.active ? whenLabel(other) : "Off"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function PriceExamples({
  plans,
  preview,
}: {
  plans: PlanOption[];
  preview: Pick<RuleGroup, "type" | "adjustmentType" | "adjustmentValue" | "triggerCondition">;
}) {
  const priced = plans.filter((p) => p.bar > 0).slice(0, 4);
  const after = (bar: number) =>
    preview.adjustmentType === "flat" ? bar + preview.adjustmentValue : Math.round(bar * (1 + preview.adjustmentValue / 100) * 100) / 100;
  const euro = (n: number) => `€${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return (
    <Card title="What it does to your prices">
      {preview.adjustmentValue === 0 || priced.length === 0 ? (
        <p className="text-muted-foreground text-sm">Enter an amount to see the new prices.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {priced.map((plan) => (
            <li key={plan.id} className="flex justify-between gap-3">
              <span>
                {plan.roomName} · {plan.name}
              </span>
              <span className="tabular-nums">
                {euro(plan.bar)} → {euro(after(plan.bar))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        From each plan&apos;s base rate, on the nights the rule matches. Prices you set for a single date change the same way.
      </p>
    </Card>
  );
}

function DeleteRule({ groupId, noun, backHref }: { groupId: string; noun: string; backHref: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const remove = async () => {
    setPending(true);
    try {
      const result = await deleteRuleGroupAction(groupId);
      if (result.ok) {
        toast.success("Rule deleted");
        router.push(backHref);
        return;
      }
      toast.error("Could not delete the rule", { description: result.error });
    } catch {
      toast.error("Could not delete the rule");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">Delete this {noun}</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          It stops applying to new bookings on every rate plan. Bookings already made keep their price.
        </p>
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Keep
          </Button>
          <Button type="button" variant="destructive" onClick={() => void remove()} disabled={pending}>
            {pending && <Spinner />}
            Delete {noun}
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
          Delete
        </Button>
      )}
    </section>
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
