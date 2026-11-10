# Checkout Details Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checkout shows the guest's saved personal details in a card of our own above a payment card that holds only Stripe's wallet buttons and payment box; Pay saves the details to the account, then charges.

**Architecture:** The Checkout Session moves from `ui_mode: 'form'` to `ui_mode: 'elements'` (Stripe's Express Checkout + Payment elements, our own Pay button). A client hook owns the details card state; Pay runs client validation → server action that upserts `guest_profile` → `checkout.confirm({ billingAddress, phoneNumber })`. `POST /api/checkout` also makes sure the checkout domain is registered on the hotel's connected account (needed for Apple Pay with direct charges), cached in Redis.

**Tech Stack:** Next.js (App Router, server actions), React 19, `@stripe/react-stripe-js` 6.8 (`/checkout` entry), `@stripe/stripe-js` 9.14, `stripe` 22.6 (Node), Upstash Redis via `@openbookings/cache`, bun test, Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-09-checkout-details-design.md` (read it first). Concept: https://claude.ai/artifact/H2sYBCU1aXgy477PYxd3SY

## Global Constraints

- Branch `feature/checkout-details`. The working tree also holds someone's uncommitted analytics files under `apps/business/**`: never `git add -A` / `git add .`; add only the paths you touched.
- EUR only, EU properties only (no other currencies in fixtures or copy).
- Raw Stripe messages never reach the guest; never say "nothing has been charged" unless it is known (`checkout/_lib/errors.ts` rules 1 and 2).
- Every price shown comes from the Checkout Session (`checkout.total`, `checkout.lineItems`), never from our rows.
- Express Checkout: `paymentMethods: { link: 'never', amazonPay: 'never' }`.
- Required at checkout: name, phone, line1, postalCode, city, country. Account page stays optional.
- Copy (exact):
  - Details hint, summary: `From your account. Changes you make here are saved there too.`
  - Details hint, form: `Saved to your account when you pay.`
  - Missing phone at checkout: `Enter a phone number so the hotel can reach you.`
  - Save failure: `We couldn't save your details. Nothing has been charged — please try again.`
  - Wallet divider: `or pay another way`
  - Pay button: `Pay {checkout.total.total.amount}`; busy: `Paying…`
  - Trust line: `You pay {propertyName} directly. Stripe handles the payment securely; OpenBookings never sees your card details.`
- Commits end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01LJ3U7HWk8diCuXCzcVeTMp`
- Test commands: `cd apps/web && bun test <path>`, `cd packages/stripe && bun test <path>`; typecheck `bun run typecheck` in the package; lint `cd apps/web && bun run lint`.

## Review Focus

1. **A phone saved before the picker existed** (doesn't parse, e.g. `0612345678` with no country) → checkout opens the details card in form state with the number kept and the phone error shown; it never crashes or sends it to Stripe. Test in Task 1 (`parseCheckoutDetails`) and Task 5 (`isCompleteForCheckout`).
2. **Pay pressed twice quickly** (double click, Enter + click) → one save and one confirm. Test in Task 7 (guard ref; browser check).
3. **First booking, no `guest_profile` row** → form state, name from the account, country picker defaults to NL, nothing pre-filled that the guest didn't give. Test in Task 5.
4. **Stripe's domain endpoint slow or down** → checkout still answers within the deadline; Apple Pay may be missing, nothing else changes. Test in Task 3 (deadline + error swallowed).
5. **Card declined after the details saved** → details stay saved (decision B), the decline copy shows, a second Pay re-saves harmlessly and confirms again. Browser check in Task 8.

---

### Task 1: Checkout validation and a shared save

**Files:**
- Modify: `apps/web/app/account/personal-details/_lib/validate.ts`
- Modify: `apps/web/app/account/personal-details/_lib/validate.test.ts`
- Create: `apps/web/lib/account/guest-details.ts`
- Modify: `apps/web/app/account/personal-details/_lib/actions.ts`
- Create: `apps/web/app/checkout/_lib/details-actions.ts`

**Interfaces:**
- Produces:
  - `export const PHONE_REQUIRED = "Enter a phone number so the hotel can reach you."` (validate.ts)
  - `export type DetailsField = "name" | "phone" | "line1" | "line2" | "postalCode" | "city" | "country"` (validate.ts)
  - `export type CheckoutDetails = { name: string; phone: string; address: Address }` (validate.ts; assignable to `Details`)
  - `export function parseCheckoutDetails(form: FormData): Parsed<CheckoutDetails, DetailsField>` (validate.ts)
  - `export async function saveGuestDetails(userId: string, currentName: string | null, details: Details): Promise<void>` (lib/account/guest-details.ts; the upsert + Better Auth name update now in `saveDetails`; throws on failure)
  - `export type CheckoutSaveResult = { ok: true; details: CheckoutDetails } | { ok: false; errors?: Partial<Record<DetailsField, string>>; message?: string }`
  - `export async function saveCheckoutDetails(form: FormData): Promise<CheckoutSaveResult>` (`"use server"`, details-actions.ts)

- [ ] **Step 1: Write failing tests** in `validate.test.ts`, describe `parseCheckoutDetails`:
  - all fields valid (`name "Sanne de Vries"`, `phone "6 23456789"`, `phoneCountry "NL"`, `line1 "Oudegracht 112"`, `postalCode "3511 AV"`, `city "Utrecht"`, `country "nl"`) → `ok`, `value.phone === "+31 6 23456789"`, `value.address.country === "NL"`, `value.address.line2 === null`.
  - empty phone → `errors.phone === PHONE_REQUIRED`.
  - phone `"0612345678"` with empty `phoneCountry` → `errors.phone === PHONE_ERROR` (Review Focus 1).
  - all address fields empty → errors for `line1`, `postalCode`, `city`, `country` with the existing `MISSING` messages (address is required here, unlike `parseAddress`).
  - empty name and empty phone together → both errors reported at once.
  - `parseDetails` unchanged: empty phone and empty address still `ok` (guard against regressions).
- [ ] **Step 2: Run** `cd apps/web && bun test app/account/personal-details/_lib/validate.test.ts` → new tests FAIL (`parseCheckoutDetails` not exported).
- [ ] **Step 3: Implement** `parseCheckoutDetails` by composing `parseName`, `parsePhone`, `parseAddress`, turning a `null` phone into `PHONE_REQUIRED` and a `null` address into the four `MISSING` errors. Export `DetailsField` and `PHONE_REQUIRED`.
- [ ] **Step 4: Run** the same test file → PASS.
- [ ] **Step 5: Move the save.** Create `saveGuestDetails` with the exact SQL now in `actions.ts` plus the `auth.api.updateUser` call when `details.name !== currentName`. Make `saveDetails` call it (behaviour unchanged). Create `saveCheckoutDetails`: no session → `{ ok: false, message: "Your session ended. Sign in again to save." }`; invalid → `{ ok: false, errors }`; save throws → `{ ok: false, message: <Save failure copy> }`; success → `revalidatePath("/account", "layout")` and `{ ok: true, details }`.
- [ ] **Step 6: Verify** `cd apps/web && bun test app/account && bun run typecheck` → PASS.
- [ ] **Step 7: Commit** the five files: `Checkout details: validation that requires phone and address, shared save`.

### Task 2: Session switches to Stripe's separate elements

**Files:**
- Modify: `packages/stripe/src/payments/checkout.ts:52-63`
- Modify: `packages/stripe/src/payments/checkout.test.ts`

**Interfaces:**
- Produces: `buildBookingCheckoutParams` returns `ui_mode: 'elements'`, no `phone_number_collection`, `billing_address_collection: 'required'`, `customer_email` unchanged.

- [ ] **Step 1: Write failing tests:** `params.ui_mode === "elements"`; `"phone_number_collection" in params === false`; `params.billing_address_collection === "required"`; `params.customer_email === "guest@example.com"`.
- [ ] **Step 2: Run** `cd packages/stripe && bun test src/payments/checkout.test.ts` → FAIL on `ui_mode` and phone collection.
- [ ] **Step 3: Implement.** Update the comments in `checkout.ts`: the form no longer collects phone, and the page passes name, address and phone on confirm. Also update the route's doc comment in `apps/web/app/api/checkout/route.ts` ("`ui_mode: 'form'` returns…") to describe `'elements'`.
- [ ] **Step 4: Run** the test → PASS; `bun run typecheck` in `packages/stripe` → PASS.
- [ ] **Step 5: Commit** `Checkout Session: Stripe's separate elements, no phone collection`.

(The web client still uses `CheckoutFormProvider` until Task 7; don't run checkout in a browser between Task 2 and Task 7.)

### Task 3: Register the checkout domain on the hotel's account

**Files:**
- Create: `packages/stripe/src/payments/payment-domain.ts`, `packages/stripe/src/payments/payment-domain.test.ts`
- Modify: `packages/stripe/src/index.ts`
- Create: `apps/web/lib/payments/checkout-domain.ts`, `apps/web/lib/payments/checkout-domain.test.ts`
- Modify: `apps/web/app/api/checkout/route.ts`

**Interfaces:**
- Produces (stripe package): `export async function ensurePaymentMethodDomain(stripeAccountId: string, domain: string): Promise<{ outcome: 'exists' | 'created' | 'enabled'; applePay: string | null }>` using `stripe.paymentMethodDomains.list({ domain_name, limit: 1 }, { stripeAccount })`, then `.create({ domain_name })` or `.update(id, { enabled: true })`; `applePay` is `apple_pay.status` of the resulting object.
- Produces (web): `export function registrableDomain(appUrl: string): string | null` (hostname, or null for `localhost`, `*.localhost`, IPv4/IPv6 literals, unparseable); `export async function ensureCheckoutDomain(stripeAccountId: string, appUrl: string, deps?: { ensure?: typeof ensurePaymentMethodDomain; redis?: RedisLike | null; report?: (err: unknown) => void; deadlineMs?: number }): Promise<void>` (never throws).
- Cache key `pmd:v1:{stripeAccountId}:{domain}`, value `"1"`, TTL `30 * 24 * 60 * 60` seconds, set only after a successful ensure. Deadline default `2500` ms (use `withDeadline` from `@openbookings/cache`).

- [ ] **Step 1: Failing tests (stripe package)**, mocking `../client` like `checkout.test.ts`: list returns an enabled domain → `outcome 'exists'`, no create; list empty → create called with `{ domain_name: "openbookings.co" }` and `{ stripeAccount: "acct_test_1" }` → `'created'`; list returns `enabled: false` → update with `{ enabled: true }` → `'enabled'`; every call carries `stripeAccount`.
- [ ] **Step 2: Failing tests (web)**: `registrableDomain` → `"openbookings.co"` for `https://openbookings.co`, `"staging.openbookings.co"` for `https://staging.openbookings.co/`, null for `http://localhost:3002`, `http://web.localhost:3002`, `http://127.0.0.1:3002`, `http://[::1]:3002`, `"not a url"`. `ensureCheckoutDomain`: cache hit → `ensure` not called; miss → called once, then `redis.set` with the key, `"1"`, `{ ex: 2592000 }`; `ensure` rejects → resolves, `report` called once, nothing cached; `ensure` never settles with `deadlineMs: 20` → resolves within ~50 ms and `report` called (Review Focus 4); localhost URL → `ensure` not called; `redis: null` → still calls `ensure`.
- [ ] **Step 3: Run both** → FAIL (modules missing).
- [ ] **Step 4: Implement** both modules; export `ensurePaymentMethodDomain` from `packages/stripe/src/index.ts`. Default `report` sends a Sentry warning tagged `{ area: 'checkout', stage: 'payment-domain' }` with `extra: { stripeAccountId, domain, applePay }`. When `applePay` is not `'active'`, report once too (warning) so a refused domain shows up.
- [ ] **Step 5: Wire into the route.** In `POST /api/checkout`, after `stripeAccountId` is known and `appUrl` resolved, run `ensureCheckoutDomain(stripeAccountId, appUrl)` alongside `openIntentSession(...)` with `Promise.all`; its result is ignored. The 409/500 paths are unchanged.
- [ ] **Step 6: Run** both test files → PASS; typecheck both packages → PASS.
- [ ] **Step 7: Commit** `Register the checkout domain on each hotel's Stripe account`.

### Task 4: Error copy for our own Pay button

**Files:**
- Modify: `apps/web/app/checkout/_lib/errors.ts`
- Create or modify: `apps/web/app/checkout/_lib/errors.test.ts`

**Interfaces:**
- Produces: `OFFLINE`, `describeValidationError(error: ValidationErrorLike): string`, `describeConfirmError(error: ConfirmErrorLike): { message: string; report: boolean; unmappedCode: string | null }` restored from `git show 2d78804^:apps/web/app/checkout/_lib/errors.ts` (adapt to the current `describeDeclineCode` / `isExpiredSessionError`, don't duplicate them); new `DETAILS_SAVE_FAILED: CheckoutErrorCopy = { message: <Save failure copy>, retryable: true }`.

- [ ] **Step 1: Failing tests:** `describeConfirmError({ type: 'card_error', code: 'card_declined', declineCode: 'insufficient_funds', message: 'raw' })` → a message that is not `'raw'` and `report === false`; an unknown decline code → `unmappedCode` set, `report === true`; an `api_error` → `report === true` and the message never contains the raw text; `DETAILS_SAVE_FAILED.message` equals the exact save-failure copy. If the pre-September `errors.test.ts` existed, restore its cases for these functions.
- [ ] **Step 2: Run** `cd apps/web && bun test app/checkout/_lib/errors.test.ts` → FAIL.
- [ ] **Step 3: Implement** by restoring from git history.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Checkout errors: restore confirm and validation copy for our Pay button`.

### Task 5: Prefill data and the details card

**Files:**
- Create: `apps/web/lib/account/countries.ts` (move `COUNTRIES` and `DIAL_CODES` construction out of `app/account/personal-details/page.tsx`; that page imports them)
- Create: `apps/web/app/account/personal-details/_components/fields.tsx` (move `Field`, `PhoneField`, `NativeSelect`, `Required`, `DialCode` out of `PersonalDetailsForms.tsx`, exported; the account form imports them; no visual change)
- Create: `apps/web/app/checkout/_lib/guest-details.ts`, `apps/web/app/checkout/_lib/guest-details.test.ts`
- Create: `apps/web/app/checkout/_components/useCheckoutDetails.ts`
- Create: `apps/web/app/checkout/_components/DetailsCard.tsx`
- Modify: `apps/web/app/checkout/[intentId]/page.tsx`

**Interfaces:**
- Produces (`guest-details.ts`, pure, client-safe):
  - `export type GuestDetailsPrefill = { name: string; email: string; phone: { country: string; number: string }; address: Address | null }`
  - `export function isCompleteForCheckout(p: GuestDetailsPrefill): boolean` — true only when `parseCheckoutDetails(prefillToFormData(p)).ok`.
  - `export function prefillToFormData(p: GuestDetailsPrefill): FormData` (keys: `name, phone, phoneCountry, line1, line2, postalCode, city, country`).
  - `export function toStripeContact(d: CheckoutDetails): { billingAddress: { name: string; address: { line1: string; line2: string | null; postal_code: string; city: string; country: string } }; phoneNumber: string }` with `phoneNumber` in E.164 (`+31623456789`).
- Produces (`useCheckoutDetails.ts`):
  - `export function useCheckoutDetails(prefill: GuestDetailsPrefill): CheckoutDetailsController`
  - `CheckoutDetailsController = { mode: 'summary' | 'form'; saved: GuestDetailsPrefill; errors: Partial<Record<DetailsField, string>>; formRef: React.RefObject<HTMLFormElement | null>; canCancel: boolean; edit(): void; cancel(): void; validate(): CheckoutDetails | null; save(): Promise<CheckoutDetails | null>; saveError: string | null }`
  - `validate()` is synchronous (wallet click has 1 s): parses the form (form mode) or `prefillToFormData(saved)` (summary mode); on failure switches to form mode, sets `errors`, focuses the first invalid field in `DetailsField` order, returns null.
  - `save()` calls `validate()`, then `saveCheckoutDetails`; on `ok` updates `saved` and returns the details; on field errors sets them (form mode) and returns null; on `message` sets `saveError` and returns null.
- Produces (`DetailsCard.tsx`): `export function DetailsCard({ controller, countries, dialCodes }: { controller: CheckoutDetailsController; countries: { code: string; name: string }[]; dialCodes: DialCode[] })`.
- Page passes new props to `CheckoutClient`: `guestDetails: GuestDetailsPrefill`, `countries`, `dialCodes`.

- [ ] **Step 1: Failing tests** in `guest-details.test.ts`: complete prefill → `isCompleteForCheckout` true; `address: null` → false; `phone.number: ""` → false; stored phone that doesn't parse (`{ country: "NL", number: "06-123" }`) → false (Review Focus 1); `toStripeContact` maps `postalCode`→`postal_code`, keeps `line2: null`, phone `"+31 6 23456789"` → `"+31623456789"`. No-row case: a prefill built the way the page builds it for `profile = null` (`splitPhone(null, "NL")`, `address: null`) → `phone.country === "NL"`, `isCompleteForCheckout` false (Review Focus 3).
- [ ] **Step 2: Run** `cd apps/web && bun test app/checkout/_lib/guest-details.test.ts` → FAIL.
- [ ] **Step 3: Implement** `guest-details.ts`; move `countries.ts` and `fields.tsx` (account page must look and behave the same: open `/account/personal-details`, save once, confirm the toast).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Page prefill.** In `[intentId]/page.tsx`, read the `guest_profile` row with the same query and trimming as the account page, build `GuestDetailsPrefill` (name from session, email from session, phone via `splitPhone(stored, addressCountry ?? "NL")`), and pass it with `COUNTRIES` / `DIAL_CODES`. Add the props to `CheckoutClientProps` (unused until Task 7 is fine).
- [ ] **Step 6: Build `useCheckoutDetails` and `DetailsCard`** per the spec's "Details card behaviour": the card shell is `rounded-3xl bg-white/70 p-4 shadow-2xl backdrop-blur-md sm:p-5`, heading `Your details` (14px semibold); summary rows Email (with a `Lock` icon, `aria-label="Can't be changed here"`), Phone, Address (one line: `line1[, line2], postalCode city, Country name`); `Edit` / `Cancel` as underlined text buttons; form uses the moved `Field` / `PhoneField` / `NativeSelect` with `required` marks on name, phone, line1, postalCode, city, country, email as a read-only input with the lock. The card is `<form noValidate onSubmit={e => e.preventDefault()}>` so Enter doesn't submit. Initial mode: `isCompleteForCheckout(prefill) ? 'summary' : 'form'`. Keep the card light in dark mode (wrap in a `light` scope or pin colors; the account form's tokens otherwise flip).
- [ ] **Step 7: Verify** `bun run typecheck` and `bun run lint` in `apps/web` → PASS.
- [ ] **Step 8: Commit** `Checkout: prefill personal details and the details card`.

### Task 6: TripSummary and CheckoutClient on the elements provider

**Files:**
- Modify: `apps/web/app/checkout/_components/CheckoutClient.tsx`
- Modify: `apps/web/app/checkout/_components/TripSummary.tsx:5,298`
- Modify: `apps/web/app/checkout/_lib/appearance.ts` (return type `Appearance`; `rules` optional)

**Interfaces:**
- Consumes: `useCheckoutDetails`, `DetailsCard` (Task 5).
- Produces: `CheckoutSession` renders `<CheckoutElementsProvider stripe options={{ clientSecret, elementsOptions: { appearance } }}>`; right column = `<div className="flex flex-col gap-4">` with, in order: the non-refundable consent card (moved out of `PaymentCard`, same copy and checkbox, own light card) when `requiresNonRefundableConsent`; `<DetailsCard>`; then `<PaymentCardBoundary><PaymentCard …/></PaymentCardBoundary>` only when `!requiresNonRefundableConsent || consented` (decision A). `PaymentCard` gets new props `details: CheckoutDetailsController` and `propertyName: string`.
- `TripSummary`'s `Ledger` uses `useCheckoutElements()` (same `checkout.lineItems` / `checkout.total` shape).

- [ ] **Step 1: Implement** the provider swap and column. Check the `elementsOptions` key name against `StripeCheckoutElementsSdkOptions` (it is `elementsOptions.appearance` in 9.14).
- [ ] **Step 2: Verify** `bun run typecheck` in `apps/web` → PASS (PaymentCard will fail to typecheck until Task 7; do Tasks 6 and 7 back to back and commit them together if needed).
- [ ] **Step 3: Commit** with Task 7.

### Task 7: The slim payment card

**Files:**
- Modify: `apps/web/app/checkout/_components/PaymentCard.tsx` (rewrite)

**Interfaces:**
- Consumes: `useCheckoutElements`, `ExpressCheckoutElement`, `PaymentElement` from `@stripe/react-stripe-js/checkout`; `CheckoutDetailsController.validate/save`, `toStripeContact` (Task 5); `describeConfirmError`, `describeValidationError`, `OFFLINE`, `DETAILS_SAVE_FAILED`, `isExpiredSessionError` (Task 4).
- Props: `{ holdLapsed: boolean; onRestart: () => void; backHref: string; details: CheckoutDetailsController; propertyName: string }`.

- [ ] **Step 1: Card states** (keep from today): `holdLapsed || sessionLapsed` → `CHECKOUT_EXPIRED` notice; provider `loading` → skeleton; provider `error` → `session_failed` notice + Sentry once; session `expired` / `complete` → existing notices; element `onLoadError` → `ELEMENT_LOAD_FAILED`.
- [ ] **Step 2: Layout.** Heading `Payment` with `Lock`. `ExpressCheckoutElement` with `paymentMethods: { link: 'never', amazonPay: 'never' }`; track `walletsReady` and `hasWallets = Object.values(availablePaymentMethods ?? {}).some(Boolean)` from its `onReady`. Render the divider `or pay another way` only when `hasWallets`. `PaymentElement` with `layout: 'tabs'` and `fields: { billingDetails: { name: 'never', email: 'never', phone: 'never', address: 'never' } }`; track its `onReady`. Show the skeleton over both (elements mounted but visually hidden with `invisible`/`aria-hidden`, not unmounted) until both are ready, so the wallet row never pops in (decision D).
- [ ] **Step 3: Pay (Payment Element path)** in a `<form onSubmit>`: guard with a `submittingRef` (Review Focus 2); `details.save()` → null: show `details.saveError ?? ''` in the alert line (field errors show in the card) and stop; `checkout.validateElements()` error → `describeValidationError`; `checkout.confirm(toStripeContact(saved))` → expired → `sessionLapsed`; other error → `describeConfirmError`, Sentry as the pre-September card did; offline → `OFFLINE`. Button: `Lock` + `Pay {checkout.total.total.amount}`, `Paying…` while busy, disabled only while busy. Alert line `role="alert" aria-live="assertive"` above the button.
- [ ] **Step 4: Wallet path.** `onClick={(e) => details.validate() ? e.resolve() : e.reject()}`. `onConfirm={async (e) => { const saved = await details.save(); if (!saved) { e.paymentFailed(); return; } const r = await checkout.confirm({ expressCheckoutConfirmEvent: e, ...toStripeContact(saved) }); … }}` with the same error handling as Step 3. If the browser check in Task 8 shows Stripe rejects `billingAddress` with a wallet event, drop it for this path only (keep `phoneNumber` if accepted) and note it in a comment.
- [ ] **Step 5: Footer.** Trust line (exact copy, `propertyName` from props), then the existing `/powered-by-stripe.svg` badge.
- [ ] **Step 6: Verify** `bun run typecheck` and `bun run lint` in `apps/web`; `bun test app/checkout` → PASS.
- [ ] **Step 7: Commit** Tasks 6 and 7: `Checkout: details card above a payment card with only Stripe's payment box`.

### Task 8: Browser check in test mode

**Files:** none (fixes go back to the task that owns the code).

- [ ] **Step 1:** Start the web app on `localhost:3002`, sign in as a test guest, start a booking at a demo property with a Flexible rate.
- [ ] **Step 2: Console.** No Stripe `IntegrationError` (the September failure mode: options valid in types but rejected at runtime). Check `fields.billingDetails`, `layout`, `paymentMethods`, `elementsOptions`.
- [ ] **Step 3: States.** Guest with a complete profile → summary; remove the phone on the account page → form state with `PHONE_REQUIRED`; Edit then Cancel restores the summary.
- [ ] **Step 4: Pay paths.** Invalid phone → inline error, no Stripe call (Network tab). `4242 4242 4242 4242` → return page confirms; `/account/personal-details` shows any edited value; the host's reservation in `business.localhost:3001` shows the new phone. 3-D Secure `4000 0025 0000 3155` → challenge then success. Declined `4000 0000 0000 9995` → decline copy, details stay saved, second Pay with 4242 succeeds (Review Focus 5). Double-click Pay → one confirm request (Review Focus 2).
- [ ] **Step 5: Non-refundable rate.** No payment card or Stripe badge until ticked; details card editable before.
- [ ] **Step 6: Phone width (390px).** Summary card, then payment card; no horizontal scroll.
- [ ] **Step 7:** Full suite: `bun run test` and `bun run typecheck` at the repo root → PASS. Commit any fixes with the task they belong to.
- [ ] **Step 8:** Note for after merge: check Apple Pay on a deployed preview (Safari with a Wallet card); `localhost` can't show it.
