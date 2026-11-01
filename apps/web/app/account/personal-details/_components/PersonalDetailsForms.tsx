"use client";

import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PendingButton } from "../../_components/pending-button";
import { Section } from "../../_components/section";
import { saveAddress, saveName, savePhone, type SaveState } from "../_lib/actions";
import type { Address } from "../_lib/validate";

const IDLE: SaveState = { status: "idle" };

/** Toasts once per save, and keeps field errors next to their fields. */
function useSave(action: (prev: SaveState, form: FormData) => Promise<SaveState>, saved: string) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const shown = React.useRef<SaveState | null>(null);
  React.useEffect(() => {
    if (state === shown.current) return;
    shown.current = state;
    if (state.status === "saved") toast.success(saved);
    else if (state.status === "error" && state.message) toast.error(state.message);
  }, [state, saved]);
  return { errors: state.errors ?? {}, formAction, pending };
}

function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactElement<{ "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {React.cloneElement(children, { "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-(--red-11)">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function FormCard({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-5 p-5">{children}</div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t px-5 py-3">{footer}</div>
    </Card>
  );
}

export function NameForm({ name }: { name: string }) {
  const { errors, formAction, pending } = useSave(saveName, "Name saved");
  return (
    <Section id="details-name" title="Name" helper="How properties address you, and the name on your bookings.">
      <form action={formAction} noValidate>
        <FormCard footer={<PendingButton type="submit" pending={pending}>Save name</PendingButton>}>
          <Field id="name" label="Full name" error={errors.name}>
            <Input id="name" name="name" defaultValue={name} autoComplete="name" maxLength={100} required className="h-11" />
          </Field>
        </FormCard>
      </form>
    </Section>
  );
}

export function PhoneForm({ phone }: { phone: string | null }) {
  const { errors, formAction, pending } = useSave(savePhone, "Phone number saved");
  return (
    <Section
      id="details-phone"
      title="Phone number"
      helper="Optional. The property you're staying with can call you about your arrival."
    >
      <form action={formAction} noValidate>
        <FormCard footer={<PendingButton type="submit" pending={pending}>Save phone number</PendingButton>}>
          <Field id="phone" label="Phone number" error={errors.phone} hint="Include the country code, like +31 6 1234 5678. Leave empty to remove it.">
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={phone ?? ""}
              autoComplete="tel"
              maxLength={20}
              className="h-11"
            />
          </Field>
        </FormCard>
      </form>
    </Section>
  );
}

/**
 * `countries` comes from the server: Node's and the browser's ICU name some
 * countries differently, so building the list here would break hydration.
 */
export function AddressForm({
  address,
  countries,
}: {
  address: Address | null;
  countries: { code: string; name: string }[];
}) {
  const { errors, formAction, pending } = useSave(saveAddress, "Address saved");
  return (
    <Section
      id="details-address"
      title="Address"
      helper="Optional. Some properties need your home address for their guest register."
      footnote="Clear every field and save to remove your address."
    >
      <form action={formAction} noValidate>
        <FormCard footer={<PendingButton type="submit" pending={pending}>Save address</PendingButton>}>
          <Field id="line1" label="Street and number" error={errors.line1}>
            <Input id="line1" name="line1" defaultValue={address?.line1 ?? ""} autoComplete="address-line1" maxLength={200} className="h-11" />
          </Field>
          <Field id="line2" label="Apartment, floor (optional)" error={errors.line2}>
            <Input id="line2" name="line2" defaultValue={address?.line2 ?? ""} autoComplete="address-line2" maxLength={200} className="h-11" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
            <Field id="postalCode" label="Postcode" error={errors.postalCode}>
              <Input id="postalCode" name="postalCode" defaultValue={address?.postalCode ?? ""} autoComplete="postal-code" maxLength={20} className="h-11" />
            </Field>
            <Field id="city" label="City" error={errors.city}>
              <Input id="city" name="city" defaultValue={address?.city ?? ""} autoComplete="address-level2" maxLength={100} className="h-11" />
            </Field>
          </div>
          <Field id="country" label="Country" error={errors.country}>
            <select
              id="country"
              name="country"
              defaultValue={address?.country ?? ""}
              autoComplete="country"
              className="h-11 w-full rounded-md border border-input bg-input/30 px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
            >
              <option value="">Choose a country</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </FormCard>
      </form>
    </Section>
  );
}
