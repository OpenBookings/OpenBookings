"use client";

import * as React from "react";
import { AlertCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { describeCharge, type TouristTaxCharge, type TouristTaxRule } from "@openbookings/pricing";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { addTouristTaxRule } from "../../_lib/actions";
import { MAX_CHARGES, touristTaxRuleSchema } from "../../_lib/tourist-tax-schema";
import { ExampleCalculator } from "./example-calculator";

/** A charge as typed: numbers stay strings until they are saved. */
interface ChargeDraft {
  key: number;
  kind: TouristTaxCharge["kind"];
  amount: string;
  perPerson: boolean;
  perNight: boolean;
  perRoom: boolean;
  vatOff: boolean;
  vat: string;
}

let nextKey = 0;
const newCharge = (): ChargeDraft => ({
  key: nextKey++,
  kind: "fixed",
  amount: "",
  perPerson: true,
  perNight: true,
  perRoom: false,
  vatOff: false,
  vat: "",
});

/** "1 January 2027". A date has no time zone, so it is formatted as UTC. */
const longDate = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** "" → null, anything else → a number (NaN included, so the schema can say so). */
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

function toCharge(c: ChargeDraft): TouristTaxCharge {
  return {
    kind: c.kind,
    amount: num(c.amount) ?? Number.NaN,
    perPerson: c.perPerson,
    perNight: c.perNight,
    perRoom: c.perRoom,
    vatIncludedPercent: c.kind === "percent" && c.vatOff ? num(c.vat) : null,
  };
}

interface RuleDialogProps {
  propertyId: string;
  today: string;
  /**
   * Start date of the rule already waiting to start, if any. Only one may
   * wait, so while it exists a new rule can only start today.
   */
  waitingFrom: string | null;
  commissionRate: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RuleDialog({
  propertyId,
  today,
  waitingFrom,
  commissionRate,
  open,
  onOpenChange,
}: RuleDialogProps) {
  const [effectiveFrom, setEffectiveFrom] = React.useState(today);
  const [charges, setCharges] = React.useState<ChargeDraft[]>(() => [newCharge()]);
  const [childrenExempt, setChildrenExempt] = React.useState(false);
  const [maxNights, setMaxNights] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function reset() {
    setEffectiveFrom(today);
    setCharges([newCharge()]);
    setChildrenExempt(false);
    setMaxNights("");
    setError(null);
  }

  const update = (key: number, patch: Partial<ChargeDraft>) =>
    setCharges((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const draft = {
    effectiveFrom,
    charges: charges.map(toCharge),
    childrenExempt,
    maxNights: num(maxNights),
  };
  const parsed = touristTaxRuleSchema.safeParse(draft);

  // The example only prices what is already valid, so a half-typed amount
  // shows as nothing rather than as NaN.
  const previewRule: TouristTaxRule = {
    effectiveFrom,
    charges: draft.charges.filter((c) => Number.isFinite(c.amount) && c.amount > 0),
    childrenExempt,
    maxNights: draft.maxNights && draft.maxNights >= 1 ? Math.floor(draft.maxNights) : null,
  };

  function save() {
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (parsed.data.effectiveFrom < today) {
      setError("A new rule cannot start in the past.");
      return;
    }
    if (waitingFrom && parsed.data.effectiveFrom > today) {
      setError(
        `You already have a rule starting on ${longDate(waitingFrom)}. Delete it first to plan a different one.`,
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addTouristTaxRule(propertyId, parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Tourist tax rule added");
      posthog.capture("tourist_tax_rule_added", {
        charges: parsed.data.charges.map((c) => c.kind),
        children_exempt: parsed.data.childrenExempt,
      });
      onOpenChange(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>New tourist tax rule</DialogTitle>
          <DialogDescription>
            Set it up the way your town charges it. Combine charges if your town uses more than
            one, for example a percentage plus an amount per person per night.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="tt-effective-from">Effective from</FieldLabel>
              <Input
                className="w-48"
                id="tt-effective-from"
                type="date"
                min={today}
                max={waitingFrom ? today : undefined}
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                disabled={pending}
              />
              <FieldDescription>
                {waitingFrom
                  ? `Applies to nights from this date on. Your next rule already starts on ${longDate(waitingFrom)}, so a new rule can only start today; delete that one to plan a different change.`
                  : "Applies to nights from this date on. You can have one rule in force and one waiting to start."}
              </FieldDescription>
            </Field>

            <div className="flex flex-col gap-3">
              <Label>Charges</Label>
              {charges.length === 0 && (
                <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
                  No charges: guests pay no tourist tax from this date.
                </p>
              )}
              {charges.map((c, i) => (
                <ChargeEditor
                  key={c.key}
                  index={i}
                  charge={c}
                  disabled={pending}
                  onChange={(patch) => update(c.key, patch)}
                  onRemove={() => setCharges((cs) => cs.filter((x) => x.key !== c.key))}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={pending || charges.length >= MAX_CHARGES}
                onClick={() => setCharges((cs) => [...cs, newCharge()])}
              >
                <PlusIcon />
                Add a charge
              </Button>
            </div>

            <Field orientation="horizontal">
              <Switch
                id="tt-children"
                checked={childrenExempt}
                onCheckedChange={setChildrenExempt}
                disabled={pending}
              />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="tt-children">Children don&apos;t pay</FieldLabel>
                <FieldDescription>Per-person charges count adults only.</FieldDescription>
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="tt-max-nights">Maximum nights taxed</FieldLabel>
              <InputGroup className="w-48">
                <InputGroupInput
                  id="tt-max-nights"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="No maximum"
                  value={maxNights}
                  onChange={(e) => setMaxNights(e.target.value)}
                  disabled={pending}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>nights</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>Some towns stop charging after a number of nights.</FieldDescription>
            </Field>
          </FieldGroup>

          <div className="lg:sticky lg:top-0 lg:self-start">
            <ExampleCalculator
              rules={[previewRule]}
              commissionRate={commissionRate}
              defaultArrival={effectiveFrom || today}
            />
          </div>
        </div>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending && <Spinner />}
            Save rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ChargeEditorProps {
  index: number;
  charge: ChargeDraft;
  disabled: boolean;
  onChange: (patch: Partial<ChargeDraft>) => void;
  onRemove: () => void;
}

function ChargeEditor({ index, charge, disabled, onChange, onRemove }: ChargeEditorProps) {
  const id = `tt-charge-${charge.key}`;
  const amount = num(charge.amount);
  const summary =
    amount && amount > 0 ? describeCharge({ ...toCharge(charge), amount }) : null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={charge.kind}
          onValueChange={(v) => v && onChange({ kind: v as ChargeDraft["kind"] })}
          disabled={disabled}
          aria-label={`Charge ${index + 1} type`}
        >
          <ToggleGroupItem value="fixed">Fixed amount</ToggleGroupItem>
          <ToggleGroupItem value="percent">Percentage of room price</ToggleGroupItem>
        </ToggleGroup>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove charge ${index + 1}`}
        >
          <Trash2Icon />
        </Button>
      </div>

      <InputGroup className="w-40">
        {charge.kind === "fixed" && (
          <InputGroupAddon>
            <InputGroupText>€</InputGroupText>
          </InputGroupAddon>
        )}
        <InputGroupInput
          id={`${id}-amount`}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          placeholder={charge.kind === "fixed" ? "2.50" : "12.5"}
          value={charge.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          disabled={disabled}
          aria-label={`Charge ${index + 1} amount`}
        />
        {charge.kind === "percent" && (
          <InputGroupAddon align="inline-end">
            <InputGroupText>%</InputGroupText>
          </InputGroupAddon>
        )}
      </InputGroup>

      {/* How the amount applies, on a row of its own. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {charge.kind === "fixed" ? (
          <>
            {(
              [
                ["perPerson", "Per person"],
                ["perRoom", "Per room"],
                ["perNight", "Per night"],
              ] as const
            ).map(([flag, label]) => (
              <div key={flag} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-${flag}`}
                  checked={charge[flag]}
                  onCheckedChange={(v) => onChange({ [flag]: v === true })}
                  disabled={disabled}
                />
                <Label htmlFor={`${id}-${flag}`} className="font-normal">
                  {label}
                </Label>
              </div>
            ))}
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-vat`}
              checked={charge.vatOff}
              onCheckedChange={(v) => onChange({ vatOff: v === true })}
              disabled={disabled}
            />
            <Label htmlFor={`${id}-vat`} className="font-normal">
              Leave VAT out first
            </Label>
            {charge.vatOff && (
              <InputGroup className="w-24">
                <InputGroupInput
                  type="number"
                  min={0}
                  step="0.1"
                  inputMode="decimal"
                  placeholder="9"
                  value={charge.vat}
                  onChange={(e) => onChange({ vat: e.target.value })}
                  disabled={disabled}
                  aria-label={`Charge ${index + 1} VAT rate`}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>%</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            )}
          </div>
        )}
      </div>

      <p className="text-muted-foreground text-xs" aria-live="polite">
        {summary ?? "Enter an amount."}
        {charge.kind === "fixed" && !charge.perPerson && !charge.perRoom && !charge.perNight && summary
          ? " Charged once for the whole booking."
          : ""}
      </p>
    </div>
  );
}
