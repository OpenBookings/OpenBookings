# Checkout: personal details card + slim payment card

Date: 2026-11-09 · Concept (approved): https://claude.ai/artifact/H2sYBCU1aXgy477PYxd3SY

## Why

Guests can save name, phone and address under Account → Personal details
(`guest_profile`, migration 0028). Checkout ignores it:

- Nothing is prefilled. The Stripe embedded form (`ui_mode: 'form'`) gets only
  `customer_email`, so phone, name and address start empty every time.
- Nothing typed at checkout is saved. Stripe keeps it; our webhook never reads
  `customer_details`. Hosts read phone and address from `guest_profile` only
  (`apps/business/lib/reservations/shape.ts`, `break-glass.ts`), so whatever a
  guest types into Stripe never reaches the host.

Wouter wants the saved details shown in their own card above a payment card
stripped to the bare minimum, with edits saved back to the account.

## Goals

- The right column of checkout becomes, top to bottom:
  1. Non-refundable consent (only when a room is on a non-refundable rate).
  2. **Your details** card (ours): name, email (locked), phone, address,
     prefilled from the account.
  3. **Payment** card: Stripe's wallet buttons and payment box only, plus our
     Pay button, a trust line and the Powered by Stripe badge.
- Pressing Pay validates the details, saves them to the account, then asks
  Stripe to charge. If the details can't be saved, nothing is charged.
- Hosts always get phone and address for a paid booking.
- Apple Pay can actually appear: our checkout domain is registered on each
  hotel's connected account (Stripe requires this for direct charges).

## Non-goals

- No change to the left half of checkout (`TripSummary`) beyond swapping the
  Stripe hook it reads the price breakdown from.
- No change to the account Personal details page's behaviour (fields stay
  optional there).
- No snapshot of guest details onto the booking row; hosts keep reading the
  live `guest_profile`.
- No change to the return page, webhook, refunds or commission logic.

## Anti-goals (would make this a failure even if it works)

- A charge going through while the guest's details failed to save.
- Any price shown on the page that could differ from what Stripe charges.
- Raw Stripe error text shown to the guest (rule 1 in `checkout/_lib/errors.ts`).
- Claiming "nothing has been charged" when we don't know that (rule 2).
- An empty gap or a row that pops in/out where a wallet button would have been.

## Decided with Wouter (concept review, 9 Nov)

- **A.** Before the non-refundable box is ticked, nothing to do with payment is
  rendered: no payment card, Pay button, trust line or Stripe badge. The
  details card is shown and editable. Ticking renders the whole payment card.
- **B.** Edits are saved when Pay is pressed. No separate Save button.
- **C.** At checkout, name, phone and the full address (street, postcode, city,
  country) are required. On the account page they stay optional.
- **D.** We don't keep a list of payment methods. Stripe renders what the
  hotel's account allows, filtered by currency, amount and the guest's device.
  Our wallet row and its "or pay another way" divider render only when Stripe
  reports at least one available wallet. The payment card shows its skeleton
  until both Stripe pieces are ready, so nothing pops in or out.
- **E.** Trust line under the Pay button: "You pay {propertyName} directly.
  Stripe handles the payment securely; OpenBookings never sees your card
  details."
- **F.** Register the checkout domain on every hotel's connected account.
- Email is shown, not editable (the booking belongs to the account; it stays
  `customer_email` on the Session).
- Wallets: Link and Amazon Pay stay off, as today.

## Details card behaviour

- **Summary state** when the account already has name, phone and a complete
  address: name, then Email / Phone / Address rows, an "Edit" text button, and
  the hint "From your account. Changes you make here are saved there too."
- **Form state** when anything required is missing, or after Edit. Same fields
  and layout as the Personal details page: full name; email read-only with a
  lock; phone as flag-and-code picker plus number; street and number +
  apartment or floor; postcode, city, country. Hint: "Saved to your account
  when you pay." After Edit, a "Cancel" text button restores the saved values
  and returns to the summary (only offered when the saved values are complete).
- Phone country default: the saved number's country, else the address country,
  else NL (same as `splitPhone`'s fallback today).
- Errors use the account page's wording (`validate.ts`), plus new copy for the
  now-required fields: "Enter a phone number so the hotel can reach you." and
  the existing address messages. After a failed Pay the card is in form state,
  errors are shown inline and the first invalid field gets focus.
- Visual: same light card as the payment card (`rounded-3xl bg-white/70 p-4
  shadow-2xl backdrop-blur-md sm:p-5`), 14px semibold heading, column gap
  between cards. Fields reuse the account page's look (`Input`, `NativeSelect`,
  `PhoneField`), pinned light the way `appearance.ts` pins Stripe's palette,
  because the card sits on a photograph in every theme.

## Payment card behaviour

- Heading "Payment" with a lock icon.
- Wallet row: Stripe's Express Checkout element (Apple Pay, Google Pay; Link
  and Amazon Pay never). Shown only when its `ready` event reports at least
  one available method; then a divider "or pay another way".
- Stripe's Payment Element below, `layout: 'tabs'` (as before September), with
  billing name/email/phone/address fields set to `never`: we pass them on
  confirm. With one method Stripe drops the tabs itself.
- Pay button (ours): lock icon + "Pay {checkout.total.total.amount}", the
  amount read from the Session. "Paying…" and disabled while working. Never
  disabled just because fields are incomplete: pressing it explains what's
  missing.
- One `role="alert"` line above the button for errors (validation, declines,
  save failure), as the pre-September card had.
- Trust line (E), then the Powered by Stripe badge (existing asset).
- Takeovers stay as today: lapsed hold / expired session → `CHECKOUT_EXPIRED`;
  completed session → `CHECKOUT_ALREADY_PAID`; provider error and element
  load failure → existing notices with retry.

## What Pay does (card and other Payment Element methods)

1. Validate the details client-side with the same rules as the server; on
   failure show errors, open the form state, stop.
2. Call a server action that validates again (checkout rules), upserts
   `guest_profile` and updates the user's name through Better Auth (same code
   path as the account page's `saveDetails`). On failure: "We couldn't save
   your details. Nothing has been charged — please try again." Stop.
3. `checkout.confirm({ billingAddress: { name, address }, phoneNumber })`.
   Stripe handles 3-D Secure and redirects to `return_url`.
4. Errors from confirm: an expired Session → the expired takeover; anything
   else → guest copy from the decline map (`describeConfirmError` existed
   before September and is restored from git history), reported to Sentry
   the way the pre-September card did.

Wallet path (Apple Pay, Google Pay). Stripe requires the Express Checkout
element's `click` handler to call `resolve()` or `reject()` within 1 second,
too short for a server round trip. So:

- `click`: step 1 only (client-side validation, synchronous). Invalid →
  `event.reject()`, the details card opens on the problem. Valid →
  `event.resolve()` and the wallet sheet opens.
- `confirm` event: step 2 (save). If saving fails → `event.paymentFailed()`,
  the error line shows the save-failure copy, nothing is charged. Otherwise
  `checkout.confirm({ expressCheckoutConfirmEvent: event, billingAddress,
  phoneNumber })`. If Stripe refuses our billing details alongside a wallet's
  own (to be checked in the browser), confirm with the wallet's details only;
  our account copy is already saved either way.

## Stripe Session changes (`packages/stripe/src/payments/checkout.ts`)

- `ui_mode: 'elements'` (Elements with the Checkout Sessions API), replacing
  `'form'`.
- Drop `phone_number_collection` (we send the phone on confirm).
- Keep `billing_address_collection: 'required'`, so Stripe still insists on
  the address we pass.
- Everything else unchanged: direct charge, application fee, metadata,
  `return_url`, `expires_at`, `customer_email`, payment method configuration.

Client: `CheckoutFormProvider` / `useCheckoutForm` → `CheckoutElementsProvider`
/ `useCheckoutElements` in `CheckoutClient`, `PaymentCard` and `TripSummary`.
Mixing the two providers throws, so all three move together.
`buildAppearance` may use `rules` again; that's optional.

## Prefill data

`/checkout/[intentId]/page.tsx` already reads the signed-in viewer. It also
reads that user's `guest_profile` row (same query as the account page) and
passes `{ name, email, phone: splitPhone(...), address }` plus the country and
dial-code lists (built server-side, as the account page does, to avoid
hydration mismatches between Node and browser ICU).

## Domain registration (F)

- New helper in `packages/stripe`: `ensurePaymentMethodDomain(accountId,
  domain)`: list the account's `payment_method_domains` filtered by
  `domain_name`; create one if missing; if present but disabled, enable it.
  Returns the Apple Pay status for logging.
- Called from `POST /api/checkout` in parallel with opening the Session, and
  awaited (with the Session) before the route answers, so the domain is
  registered before the browser mounts the Express Checkout element.
- Cached in Redis per `{accountId, domain}` for 30 days (`getRedis`), so it's
  one Stripe call per hotel per month at most. A Redis outage just means an
  extra Stripe call.
- Never blocks checkout: any error goes to Sentry (warning) and the route
  continues. Worst case Apple Pay doesn't show for that guest.
- Skipped when the app URL's host is `localhost`, an IP, or ends in
  `.localhost` (Stripe can't register those).
- My call, replacing "on connect + one-off backfill" from the chat: doing it
  at checkout covers new hotels, existing hotels and any future domain change
  with one code path, and needs no backfill script.

## Code to reuse or restore

- `apps/web/app/account/personal-details/_lib/validate.ts`: add a checkout
  variant of `parseDetails` that also requires phone and address. Keep the
  account-page behaviour unchanged.
- The account page's `saveDetails` SQL + name update moves into a shared
  server-side function both actions call.
- `PersonalDetailsForms.tsx`: `Field`, `PhoneField`, `NativeSelect` are
  exported (or moved to a shared file) for the checkout card.
- `checkout/_lib/errors.ts`: restore `describeConfirmError` /
  `describeValidationError` / `OFFLINE` from `2d78804^` if they were removed.
- `PaymentCard` pre-September (`git show 2d78804^:apps/web/app/checkout/_components/PaymentCard.tsx`)
  for the submit/confirm/error pattern.

## Known risk

The September migration happened because an option valid in `@stripe/stripe-js`
9.14's types (`fields.phone` on the Billing Address element) was rejected by
the deployed Stripe.js at runtime. Every Stripe option used here has to be
checked in a browser against a real test-mode Session, not only by `tsc`.

## Testing

- Unit (bun): checkout validation variant (required phone/address, errors),
  Session params (`ui_mode`, no phone collection, address still required),
  `ensurePaymentMethodDomain` (exists / missing / disabled / error),
  the domain skip rule, the cache key.
- Browser, test mode, on `localhost:3002`: summary state; form state with
  missing phone; Edit + Cancel; Pay with an invalid phone (no charge, inline
  error); Pay with 4242 (profile updated, booking confirmed, host sees new
  phone); 3-D Secure card 4000002500003155; declined 4000000000009995;
  non-refundable rate (no payment card until ticked); phone width.
- Apple Pay can't be shown on localhost; it is checked on a deployed preview
  after merge.

## Left to the builder

- Exact component split (e.g. `DetailsCard.tsx`, `useGuestDetails`), and where
  the shared field components live.
- How the details state is lifted so `PaymentCard` can read it on Pay
  (context or props from `CheckoutSession`).
- Skeleton shape while Stripe loads.
