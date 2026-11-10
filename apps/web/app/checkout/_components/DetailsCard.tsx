'use client';

import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Field,
  INPUT,
  NativeSelect,
  PhoneField,
  type DialCode,
} from '@/app/account/personal-details/_components/fields';
import { dialCode } from '@/app/account/personal-details/_lib/phone';
import type { CheckoutDetailsController } from './useCheckoutDetails';

type Country = { code: string; name: string };

/** The light card both of checkout's own blocks sit in, matching the payment card. */
export const CHECKOUT_CARD = 'checkout-light rounded-3xl bg-white/70 p-4 shadow-2xl backdrop-blur-md sm:p-5';

function addressLine(saved: CheckoutDetailsController['saved'], countries: Country[]): string {
  const a = saved.address;
  if (!a) return '';
  const country = countries.find((c) => c.code === a.country)?.name ?? a.country;
  return [a.line2 ? `${a.line1}, ${a.line2}` : a.line1, `${a.postalCode} ${a.city}`, country].join(', ');
}

/** The summary shows the number as saved: "+31 6 23456789". */
function phonePrefix(saved: CheckoutDetailsController['saved']): string {
  return dialCode(saved.phone.country) ?? '';
}

function TextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-[13px] font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}

function Summary({ saved, countries }: { saved: CheckoutDetailsController['saved']; countries: Country[] }) {
  const rows: [string, React.ReactNode][] = [
    [
      'Email',
      <span key="email" className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
        {saved.email}
        <Lock aria-label="Can't be changed here" className="size-3 shrink-0 text-muted-foreground" />
      </span>,
    ],
    ['Phone', saved.phone.number ? `+${phonePrefix(saved)} ${saved.phone.number}` : ''],
    ['Address', addressLine(saved, countries)],
  ];
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <p className="text-[15px] font-semibold">{saved.name}</p>
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="pt-px text-xs text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The guest's details at checkout, from their account. Pay saves whatever is
 * here back to the account (and so to the hotel) before anything is charged.
 */
export function DetailsCard({
  controller,
  countries,
  dialCodes,
}: {
  controller: CheckoutDetailsController;
  countries: Country[];
  dialCodes: DialCode[];
}) {
  const { mode, saved, errors, bindForm, edit, cancel, canCancel } = controller;
  return (
    <section aria-labelledby="checkout-details-heading" className={CHECKOUT_CARD}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="checkout-details-heading" className="text-sm font-semibold">
          Your details
        </h2>
        {mode === 'summary' ? (
          <TextButton onClick={edit}>Edit</TextButton>
        ) : canCancel ? (
          <TextButton onClick={cancel}>Cancel</TextButton>
        ) : null}
      </div>

      {mode === 'summary' ? (
        <Summary saved={saved} countries={countries} />
      ) : (
        // Its own form so Enter in a field never reaches the Pay button's form.
        <form ref={bindForm} noValidate onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
          <Field id="name" label="Full name" required error={errors.name}>
            <Input id="name" name="name" defaultValue={saved.name} autoComplete="name" maxLength={100} required className={INPUT} />
          </Field>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="checkout-email" className="text-[13px] text-muted-foreground">
              Email
            </label>
            <div className="relative">
              <Lock aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="checkout-email"
                value={saved.email}
                readOnly
                aria-describedby="checkout-email-hint"
                className={`${INPUT} pl-8 text-muted-foreground`}
              />
            </div>
            <p id="checkout-email-hint" className="sr-only">
              Your account email. It can&apos;t be changed here.
            </p>
          </div>
          <PhoneField
            country={saved.phone.country}
            number={saved.phone.number}
            dialCodes={dialCodes}
            error={errors.phone}
            showLabel
            required
          />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Field id="line1" label="Street and number" required error={errors.line1}>
              <Input id="line1" name="line1" defaultValue={saved.address?.line1 ?? ''} autoComplete="address-line1" maxLength={200} required className={INPUT} />
            </Field>
            <Field id="line2" label="Apartment or floor" error={errors.line2}>
              <Input id="line2" name="line2" defaultValue={saved.address?.line2 ?? ''} autoComplete="address-line2" maxLength={200} className={INPUT} />
            </Field>
          </div>
          <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,1fr)]">
            <Field id="postalCode" label="Postcode" required error={errors.postalCode}>
              <Input id="postalCode" name="postalCode" defaultValue={saved.address?.postalCode ?? ''} autoComplete="postal-code" maxLength={20} required className={INPUT} />
            </Field>
            <Field id="city" label="City" required error={errors.city}>
              <Input id="city" name="city" defaultValue={saved.address?.city ?? ''} autoComplete="address-level2" maxLength={100} required className={INPUT} />
            </Field>
            <Field id="country" label="Country" required error={errors.country} className="col-span-2 sm:col-span-1">
              <NativeSelect
                id="country"
                name="country"
                defaultValue={saved.address?.country ?? saved.phone.country}
                autoComplete="country"
                required
              >
                <option value="">Choose a country</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </form>
      )}

      <p className="mt-3 border-t border-black/10 pt-3 text-xs text-muted-foreground">
        {mode === 'summary'
          ? 'From your account. Changes you make here are saved there too.'
          : 'Saved to your account when you pay.'}
      </p>
    </section>
  );
}
