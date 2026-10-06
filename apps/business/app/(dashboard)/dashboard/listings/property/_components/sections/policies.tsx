"use client";

import * as React from "react";
import { FileClockIcon, ShieldCheckIcon } from "lucide-react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { savePolicies } from "../../_lib/actions";
import { PAYMENT_METHODS } from "../../_lib/schema";
import type { FormState, PropertyEditorData } from "../../_lib/types";
import { InfoTip } from "../info-tip";
import { RepeatableRows } from "../repeatable-rows";
import { SectionForm } from "../../../_components/section-form";
import type { SectionProps } from "./props";

const METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  wero: "Wero",
  applepay: "Apple Pay",
};

/** Pre-filled for a host with no fine print yet. Every line is editable. */
const DEFAULT_FINE_PRINT = [
  "Guests must show a valid photo ID at check-in.",
  "Smoking is not allowed inside the property.",
  "Parties and events are not allowed.",
  "Quiet hours are from 22:00 to 07:00.",
];

const FINE_PRINT_SUGGESTIONS = [
  ...DEFAULT_FINE_PRINT,
  "The name on the booking must match the guest checking in.",
  "Special requests are subject to availability.",
];

type FeeMode = "unavailable" | "free" | "paid";

/** "" (not offered) and 0 (free) are different answers; the select makes that visible. */
function feeModeOf(fee: number | null): FeeMode {
  if (fee === null) return "unavailable";
  return fee === 0 ? "free" : "paid";
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs uppercase tracking-wide">{children}</p>;
}

export function PoliciesSection({ data, onDirtyChange }: SectionProps) {
  // Selects, switches and rows below hold their values in React state, which a
  // form reset cannot reach. Remounting the fields is what makes Discard work.
  const [resetKey, setResetKey] = React.useState(0);

  return (
    <SectionForm
      sectionId="policies"
      title="Policies"
      description="What guests need to know before they book."
      entityId={data.property.id}
      initialValues={{} as Record<string, unknown>}
      action={savePolicies}
      onDirtyChange={onDirtyChange}
      onReset={() => setResetKey((k) => k + 1)}
    >
      {(state, pending, markDirty) => (
        <PoliciesFields
          key={resetKey}
          data={data}
          state={state}
          pending={pending}
          markDirty={markDirty}
        />
      )}
    </SectionForm>
  );
}

function PoliciesFields({
  data,
  state,
  pending,
  markDirty,
}: {
  data: PropertyEditorData;
  state: FormState<Record<string, unknown>>;
  pending: boolean;
  markDirty: () => void;
}) {
  const { property, content } = data;
  const [cotPolicy, setCotPolicy] = React.useState(content.cotPolicy ?? "");
  const [extraBed, setExtraBed] = React.useState<FeeMode>(feeModeOf(content.extraBedFee));
  // Filtered to what the form still accepts, so a row saved before cash was
  // retired cannot post a code the save schema rejects.
  const [methods, setMethods] = React.useState<string[]>(() =>
    content.paymentMethods.filter((m) => (PAYMENT_METHODS as readonly string[]).includes(m)),
  );
  const usingDefaults = content.finePrint.length === 0;

  function toggleMethod(method: string, on: boolean) {
    setMethods((prev) => (on ? [...prev, method] : prev.filter((m) => m !== method)));
    markDirty();
  }

  return (
    <FieldGroup className="max-w-3xl">
      {/* ── Arrival & departure ─────────────────────────────────────────── */}
      <SectionHeading>Arrival &amp; departure</SectionHeading>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field data-invalid={!!state.errors?.checkInTime}>
          <FieldLabel htmlFor="checkInTime">Check-in from</FieldLabel>
          <Input
            id="checkInTime"
            name="checkInTime"
            type="time"
            defaultValue={property.checkInTime}
            disabled={pending}
            aria-invalid={!!state.errors?.checkInTime}
          />
          {state.errors?.checkInTime && <FieldError>{state.errors.checkInTime[0]}</FieldError>}
        </Field>

        <Field data-invalid={!!state.errors?.checkInUntil}>
          <FieldLabel htmlFor="checkInUntil">Check-in until</FieldLabel>
          <Input
            id="checkInUntil"
            name="checkInUntil"
            type="time"
            defaultValue={property.checkInUntil ?? ""}
            disabled={pending}
            aria-invalid={!!state.errors?.checkInUntil}
          />
          <FieldDescription>Leave blank if there is no cut-off.</FieldDescription>
          {state.errors?.checkInUntil && <FieldError>{state.errors.checkInUntil[0]}</FieldError>}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field data-invalid={!!state.errors?.checkOutTime}>
          <FieldLabel htmlFor="checkOutTime">Check-out until</FieldLabel>
          <Input
            id="checkOutTime"
            name="checkOutTime"
            type="time"
            defaultValue={property.checkOutTime}
            disabled={pending}
            aria-invalid={!!state.errors?.checkOutTime}
          />
          {state.errors?.checkOutTime && <FieldError>{state.errors.checkOutTime[0]}</FieldError>}
        </Field>
      </div>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="reception24h">24-hour reception</FieldLabel>
          <FieldDescription>Someone is at the desk around the clock.</FieldDescription>
        </FieldContent>
        <Switch
          id="reception24h"
          name="reception24h"
          defaultChecked={content.reception24h}
          disabled={pending}
        />
      </Field>

      {/* ── Cancellation ────────────────────────────────────────────────── */}
      <FieldSeparator />
      <SectionHeading>Cancellation</SectionHeading>

      {/*
        Cancellation is moving to a full policy. Until it lands the stored
        window is posted back unchanged, so saving this section never quietly
        rewrites what guests were promised.
      */}
      <input type="hidden" name="freeCancellationDays" value={content.freeCancellationDays ?? ""} />
      <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border">
          <FileClockIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium text-sm">
            Cancellation policy{" "}
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 font-normal text-muted-foreground text-xs">
              Coming soon
            </span>
          </p>
          <p className="text-muted-foreground text-sm">
            You will soon set your cancellation terms as one complete policy — deadlines, fees
            and refunds together. Nothing to fill in here yet.
          </p>
        </div>
      </div>

      {/* ── Children & beds ─────────────────────────────────────────────── */}
      <FieldSeparator />
      <SectionHeading>Children &amp; beds</SectionHeading>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="childrenWelcome">Children welcome</FieldLabel>
          <FieldDescription>
            Guests may bring children of any age. Turn off if your property is adults-only.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="childrenWelcome"
          name="childrenWelcome"
          defaultChecked={content.childrenWelcome}
          disabled={pending}
        />
      </Field>

      <Field orientation="horizontal" data-invalid={!!state.errors?.cotFee}>
        <FieldContent>
          <FieldLabel htmlFor="cotPolicy">Baby cots</FieldLabel>
          <FieldDescription>A cot placed in the room for an infant, on request.</FieldDescription>
          {state.errors?.cotFee && <FieldError>{state.errors.cotFee[0]}</FieldError>}
        </FieldContent>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Select
            name="cotPolicy"
            value={cotPolicy}
            onValueChange={(v) => {
              setCotPolicy(v);
              markDirty();
            }}
            disabled={pending}
          >
            <SelectTrigger id="cotPolicy" className="w-52">
              <SelectValue placeholder="Not stated" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unavailable">Not available</SelectItem>
              <SelectItem value="free">Free of charge</SelectItem>
              <SelectItem value="paid">For a fee</SelectItem>
            </SelectContent>
          </Select>
          {cotPolicy === "paid" && (
            <InputGroup className="w-52">
              <InputGroupAddon>
                <InputGroupText>€</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="cotFee"
                name="cotFee"
                type="number"
                min={0}
                step={1}
                defaultValue={content.cotFee ?? ""}
                disabled={pending}
                aria-label="Cot fee"
                aria-invalid={!!state.errors?.cotFee}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>per night</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          )}
        </div>
      </Field>

      <Field orientation="horizontal" data-invalid={!!state.errors?.extraBedFee}>
        <FieldContent>
          <FieldLabel htmlFor="extraBedMode">Extra beds</FieldLabel>
          <FieldDescription>A rollaway bed added to a room, for an extra guest.</FieldDescription>
          {state.errors?.extraBedFee && <FieldError>{state.errors.extraBedFee[0]}</FieldError>}
        </FieldContent>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Select
            value={extraBed}
            onValueChange={(v) => {
              setExtraBed(v as FeeMode);
              markDirty();
            }}
            disabled={pending}
          >
            <SelectTrigger id="extraBedMode" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unavailable">Not available</SelectItem>
              <SelectItem value="free">Free of charge</SelectItem>
              <SelectItem value="paid">For a fee</SelectItem>
            </SelectContent>
          </Select>
          {/* Stored as one nullable fee: blank is "not offered", 0 is "free". */}
          {extraBed === "paid" ? (
            <InputGroup className="w-52">
              <InputGroupAddon>
                <InputGroupText>€</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="extraBedFee"
                name="extraBedFee"
                type="number"
                min={1}
                step={1}
                required
                defaultValue={content.extraBedFee || ""}
                disabled={pending}
                aria-label="Extra bed fee"
                aria-invalid={!!state.errors?.extraBedFee}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>per night</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          ) : (
            <input type="hidden" name="extraBedFee" value={extraBed === "free" ? "0" : ""} />
          )}
        </div>
      </Field>

      {/* ── Payment ─────────────────────────────────────────────────────── */}
      <FieldSeparator />
      <SectionHeading>Payment</SectionHeading>

      {/*
        Not a setting: every payment goes through the platform, so there is no
        prepayment switch and no cash option. Stated here so a host looking for
        either finds the answer instead of a missing control.
      */}
      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border">
          <ShieldCheckIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium text-sm">Guests pay online when they book</p>
          <p className="text-muted-foreground text-sm">
            Every booking is paid through OpenBookings at the time of booking, so prepayment is
            always required. Payments at the property, including cash, are not possible.
          </p>
        </div>
      </div>

      <Field data-invalid={!!state.errors?.paymentMethods}>
        <FieldContent>
          <FieldLabel>Accepted payment methods</FieldLabel>
          <FieldDescription>Shown on your listing. Turn on every method guests can pay online with.</FieldDescription>
        </FieldContent>
        {methods.map((m) => (
          <input key={m} type="hidden" name="paymentMethods" value={m} />
        ))}
        <div className="divide-y rounded-lg border">
          {PAYMENT_METHODS.map((m) => (
            <Field key={m} orientation="horizontal" className="px-4 py-3">
              <FieldLabel htmlFor={`method-${m}`} className="font-normal">
                {METHOD_LABELS[m]}
              </FieldLabel>
              {/* No `name`: the hidden inputs above are what posts. */}
              <Switch
                id={`method-${m}`}
                checked={methods.includes(m)}
                onCheckedChange={(on) => toggleMethod(m, on)}
                disabled={pending}
              />
            </Field>
          ))}
        </div>
        {state.errors?.paymentMethods && <FieldError>{state.errors.paymentMethods[0]}</FieldError>}
      </Field>

      {/* ── Other ───────────────────────────────────────────────────────── */}
      <FieldSeparator />
      <SectionHeading>Other</SectionHeading>

      <Field orientation="horizontal" data-invalid={!!state.errors?.minCheckInAge}>
        <FieldContent>
          <FieldLabel htmlFor="minCheckInAge">Minimum check-in age</FieldLabel>
          <FieldDescription>The youngest age at which a guest can check in on their own.</FieldDescription>
          {state.errors?.minCheckInAge && <FieldError>{state.errors.minCheckInAge[0]}</FieldError>}
        </FieldContent>
        <InputGroup className="w-32 shrink-0">
          <InputGroupInput
            id="minCheckInAge"
            name="minCheckInAge"
            type="number"
            min={1}
            max={99}
            defaultValue={content.minCheckInAge ?? ""}
            disabled={pending}
            aria-invalid={!!state.errors?.minCheckInAge}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>years</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="petsAllowed">Pets allowed</FieldLabel>
          <FieldDescription>Guests may bring pets.</FieldDescription>
        </FieldContent>
        <Switch
          id="petsAllowed"
          name="petsAllowed"
          defaultChecked={content.petsAllowed}
          disabled={pending}
        />
      </Field>

      <FieldSeparator />

      <Field data-invalid={!!state.errors?.finePrint}>
        <RepeatableRows
          name="finePrint"
          ariaLabel="Fine print"
          label={
            <span className="flex items-center gap-1.5">
              Fine print
              <InfoTip label="Fine print">
                <p className="font-medium text-foreground!">What is fine print?</p>
                <p>
                  The house rules and conditions guests agree to when they book — things like ID
                  at check-in, quiet hours or no smoking.
                </p>
                <p>
                  It is listed at the bottom of your listing, so guests see it before they pay.
                  Anything that limits their stay belongs here, so it is never a surprise on
                  arrival. Do not ask for payments here: every payment goes through OpenBookings.
                </p>
                <p>Keep each line to one short, factual rule.</p>
              </InfoTip>
            </span>
          }
          description={
            usingDefaults
              ? "We started you with common rules. Edit or remove any that do not apply, then save."
              : "The conditions listed at the bottom of your listing, one per line."
          }
          placeholder="Check-in after 22:00 is possible on request."
          initialRows={usingDefaults ? DEFAULT_FINE_PRINT : content.finePrint}
          suggestions={FINE_PRINT_SUGGESTIONS}
          disabled={pending}
          onRowsChange={markDirty}
        />
        {state.errors?.finePrint && <FieldError>{state.errors.finePrint[0]}</FieldError>}
      </Field>
    </FieldGroup>
  );
}
