"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recheckVatId, saveBillingDetails, type BillingFormState } from "../actions";

export type BillingFormValues = {
  legalName: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  countryCode: string;
  vatId: string;
  kvkNumber: string;
  billingEmail: string;
};

/** What the page knows about the saved VAT number, in words the form can show. */
export type VatStatus = {
  state: "none" | "not_needed" | "verified" | "invalid" | "unverified";
  /** Already formatted, e.g. `20 Oct 2026`. */
  checkedOn: string | null;
};

const IDLE: BillingFormState = { ok: false, message: null, fieldErrors: {}, vat: null };

const VAT_NOTES: Record<NonNullable<BillingFormState["vat"]>, string | null> = {
  not_needed: null,
  verified: "Your VAT number is verified.",
  invalid: "The EU VAT register says this VAT number is not valid. Check it and save again.",
  unavailable: "We couldn't reach the EU VAT register just now, so your VAT number is not verified yet. Try Check again in a while.",
  not_configured: "Your details are saved. Your VAT number is not verified yet.",
};

function Field({
  name,
  label,
  error,
  hint,
  ...props
}: { name: keyof BillingFormValues; label: string; error?: string; hint?: string } & React.ComponentProps<"input">) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={error ? true : undefined} aria-describedby={error ? `${name}-error` : undefined} {...props} />
      {error ? (
        <p id={`${name}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function VatLine({ status, result, canUpdate }: { status: VatStatus; result: BillingFormState | null; canUpdate: boolean }) {
  const [state, recheck, pending] = useActionState(recheckVatId, IDLE);
  // The latest answer wins over what the page loaded with.
  const outcome = state.vat ?? result?.vat ?? null;
  const note = outcome ? VAT_NOTES[outcome] : null;

  let text: string | null = null;
  if (status.state === "verified") text = `Verified${status.checkedOn ? ` on ${status.checkedOn}` : ""}.`;
  else if (status.state === "invalid") text = "Not valid according to the EU VAT register.";
  else if (status.state === "unverified") text = "Not verified yet.";
  else if (status.state === "not_needed") text = "Dutch businesses need no VAT number check.";
  if (!text) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">VAT number status</p>
        <p className="text-muted-foreground" aria-live="polite">
          {text} {state.message && !state.ok ? state.message : note && note !== text ? note : ""}
        </p>
      </div>
      {canUpdate && status.state !== "not_needed" && status.state !== "none" ? (
        <form action={recheck}>
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Checking…" : "Check again"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** The legal details printed on the commission invoices. Read-only for roles that may only view. */
export function BillingDetailsForm({
  values,
  countries,
  vatStatus,
  canUpdate,
}: {
  values: BillingFormValues;
  countries: { code: string; name: string }[];
  vatStatus: VatStatus;
  canUpdate: boolean;
}) {
  const [state, save, pending] = useActionState(saveBillingDetails, IDLE);
  const err = state.fieldErrors;
  const vatNote = state.ok && state.vat ? VAT_NOTES[state.vat] : null;
  const ro = !canUpdate;

  return (
    <Card id="billing-details" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>Billing details</CardTitle>
        <CardDescription>
          The company that receives the commission invoices. These are printed on every invoice, so use the details
          registered with the tax authorities. The country decides whether the invoice carries Dutch VAT or is
          reverse-charged.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form action={save} className="flex flex-col gap-4" key={JSON.stringify(values)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field name="legalName" label="Company name" defaultValue={values.legalName} error={err.legalName} readOnly={ro} required />
            </div>
            <Field name="addressLine1" label="Address" defaultValue={values.addressLine1} error={err.addressLine1} readOnly={ro} required />
            <Field name="addressLine2" label="Address line 2 (optional)" defaultValue={values.addressLine2} error={err.addressLine2} readOnly={ro} />
            <Field name="postalCode" label="Postal code" defaultValue={values.postalCode} error={err.postalCode} readOnly={ro} required />
            <Field name="city" label="City" defaultValue={values.city} error={err.city} readOnly={ro} required />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="countryCode">Country</Label>
              <select
                id="countryCode"
                name="countryCode"
                defaultValue={values.countryCode}
                disabled={ro}
                required
                aria-invalid={err.countryCode ? true : undefined}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>
                  Choose a country
                </option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              {err.countryCode ? <p className="text-sm text-destructive">{err.countryCode}</p> : null}
            </div>
            <Field
              name="vatId"
              label="VAT number"
              defaultValue={values.vatId}
              error={err.vatId}
              hint="With the country prefix, e.g. NL123456789B01"
              readOnly={ro}
              required
              autoComplete="off"
            />
            <Field name="kvkNumber" label="Chamber of Commerce number (optional)" defaultValue={values.kvkNumber} error={err.kvkNumber} readOnly={ro} />
            <Field
              name="billingEmail"
              label="Billing email"
              type="email"
              defaultValue={values.billingEmail}
              error={err.billingEmail}
              hint="Invoices are emailed here"
              readOnly={ro}
              required
            />
          </div>

          {state.message ? (
            <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm" : "text-sm text-destructive"}>
              {state.message} {vatNote}
            </p>
          ) : null}

          {canUpdate ? (
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save billing details"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Your role can view the billing details but not change them.</p>
          )}
        </form>

        <VatLine status={vatStatus} result={state.ok ? state : null} canUpdate={canUpdate} />
      </CardContent>
    </Card>
  );
}
