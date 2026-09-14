"use client";

import * as React from "react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { savePolicies } from "../../_lib/actions";
import { PAYMENT_METHODS } from "../../_lib/schema";
import { RepeatableRows } from "../repeatable-rows";
import { SectionForm } from "../section-form";
import type { SectionProps } from "./props";

const METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  wero: "Wero",
  applepay: "Apple Pay",
  cash: "Cash (at the property)",
};

export function PoliciesSection({ data, onDirtyChange }: SectionProps) {
  const { property, content } = data;
  const [cotPolicy, setCotPolicy] = React.useState(content.cotPolicy ?? "");
  const [methods, setMethods] = React.useState<string[]>(content.paymentMethods);

  return (
    <SectionForm
      sectionId="policies"
      title="Policies"
      description="What guests need to know before they book."
      propertyId={property.id}
      initialValues={{} as Record<string, unknown>}
      action={savePolicies}
      onDirtyChange={onDirtyChange}
    >
      {(state, pending) => (
        <FieldGroup className="max-w-3xl">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Arrival &amp; departure
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
            <Switch
              id="reception24h"
              name="reception24h"
              defaultChecked={content.reception24h}
              disabled={pending}
            />
            <FieldLabel htmlFor="reception24h">24-hour reception</FieldLabel>
          </Field>

          <FieldSeparator />
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Cancellation &amp; prepayment
          </p>

          <Field data-invalid={!!state.errors?.freeCancellationDays}>
            <FieldLabel htmlFor="freeCancellationDays">Free cancellation window</FieldLabel>
            <InputGroup className="max-w-xs">
              <InputGroupInput
                id="freeCancellationDays"
                name="freeCancellationDays"
                type="number"
                min={0}
                max={365}
                defaultValue={content.freeCancellationDays ?? ""}
                disabled={pending}
                aria-invalid={!!state.errors?.freeCancellationDays}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>days before arrival</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>Enter 0 if you do not offer free cancellation.</FieldDescription>
            {state.errors?.freeCancellationDays && (
              <FieldError>{state.errors.freeCancellationDays[0]}</FieldError>
            )}
          </Field>

          <Field orientation="horizontal">
            <Switch
              id="prepaymentRequired"
              name="prepaymentRequired"
              defaultChecked={content.prepaymentRequired}
              disabled={pending}
            />
            <FieldLabel htmlFor="prepaymentRequired">Prepayment required to confirm</FieldLabel>
          </Field>

          <FieldSeparator />
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Children &amp; beds</p>

          <Field orientation="horizontal">
            <Switch
              id="childrenWelcome"
              name="childrenWelcome"
              defaultChecked={content.childrenWelcome}
              disabled={pending}
            />
            <FieldLabel htmlFor="childrenWelcome">Children of all ages welcome</FieldLabel>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="cotPolicy">Cots</FieldLabel>
              <Select
                name="cotPolicy"
                value={cotPolicy}
                onValueChange={setCotPolicy}
                disabled={pending}
              >
                <SelectTrigger id="cotPolicy">
                  <SelectValue placeholder="Not stated" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Available, free of charge</SelectItem>
                  <SelectItem value="paid">Available for a fee</SelectItem>
                  <SelectItem value="unavailable">Not available</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {cotPolicy === "paid" && (
              <Field data-invalid={!!state.errors?.cotFee}>
                <FieldLabel htmlFor="cotFee">Cot fee</FieldLabel>
                <InputGroup>
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
                    aria-invalid={!!state.errors?.cotFee}
                  />
                </InputGroup>
                {state.errors?.cotFee && <FieldError>{state.errors.cotFee[0]}</FieldError>}
              </Field>
            )}

            <Field data-invalid={!!state.errors?.extraBedFee}>
              <FieldLabel htmlFor="extraBedFee">Extra bed, per night</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>€</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="extraBedFee"
                  name="extraBedFee"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={content.extraBedFee ?? ""}
                  disabled={pending}
                  aria-invalid={!!state.errors?.extraBedFee}
                />
              </InputGroup>
              <FieldDescription>Leave blank if you do not offer extra beds.</FieldDescription>
              {state.errors?.extraBedFee && <FieldError>{state.errors.extraBedFee[0]}</FieldError>}
            </Field>
          </div>

          <FieldSeparator />
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Payment</p>

          <Field data-invalid={!!state.errors?.paymentMethods}>
            <FieldLabel>Accepted payment methods</FieldLabel>
            {methods.map((m) => (
              <input key={m} type="hidden" name="paymentMethods" value={m} />
            ))}
            <ToggleGroup
              type="multiple"
              variant="outline"
              value={methods}
              onValueChange={setMethods}
              disabled={pending}
              className="flex-wrap justify-start"
            >
              {PAYMENT_METHODS.map((m) => (
                <ToggleGroupItem key={m} value={m} aria-label={METHOD_LABELS[m]}>
                  {METHOD_LABELS[m]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {state.errors?.paymentMethods && (
              <FieldError>{state.errors.paymentMethods[0]}</FieldError>
            )}
          </Field>

          <FieldSeparator />
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Other</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field data-invalid={!!state.errors?.minCheckInAge}>
              <FieldLabel htmlFor="minCheckInAge">Minimum check-in age</FieldLabel>
              <Input
                id="minCheckInAge"
                name="minCheckInAge"
                type="number"
                min={1}
                max={99}
                defaultValue={content.minCheckInAge ?? ""}
                disabled={pending}
                aria-invalid={!!state.errors?.minCheckInAge}
              />
              {state.errors?.minCheckInAge && <FieldError>{state.errors.minCheckInAge[0]}</FieldError>}
            </Field>

            <Field orientation="horizontal" className="self-end">
              <Switch
                id="petsAllowed"
                name="petsAllowed"
                defaultChecked={content.petsAllowed}
                disabled={pending}
              />
              <Label htmlFor="petsAllowed" className="font-normal">Pets allowed</Label>
            </Field>
          </div>

          <FieldSeparator />

          <Field data-invalid={!!state.errors?.finePrint}>
            <RepeatableRows
              name="finePrint"
              label="Fine print"
              description="The conditions listed at the bottom of your listing. One per line."
              placeholder="A security deposit of €500 is required on arrival."
              initialRows={content.finePrint}
              disabled={pending}
            />
            {state.errors?.finePrint && <FieldError>{state.errors.finePrint[0]}</FieldError>}
          </Field>
        </FieldGroup>
      )}
    </SectionForm>
  );
}
