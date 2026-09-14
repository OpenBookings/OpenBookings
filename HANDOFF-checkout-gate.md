# Hand-off — checkout gate + auth

**Branch:** `checkout-gate-auth` · **Commit:** `29d9ab7` · Committed locally, **not pushed**.
Base: `main` @ `987c427`.

---

## What you asked for vs. what landed

You offered two options for the Turnstile problem. Option 1 (in-between page) won, but **without a
second URL** — a real `/checkout/verify` route would have to hand the client secret across a
navigation, and the only ways to do that are a URL query (leaks it), `sessionStorage` (fragile), or
refetching (a second Stripe Session for one booking). So the gate is a full-screen step on the same
route.

You then pushed back on my "no auth" position, and you were right about placement. My funnel
objection assumed a wall at the pay button; the gate sits *before* `/api/checkout` creates a
Session, which is a different thing entirely. Both changes 1 and 2 are in this commit.

---

## The bug you were actually seeing

`CheckoutClient.tsx` rendered the Turnstile container as a **direct child of the
`lg:grid-cols-2` grid**. Collapsed to `h-0` it still occupied a grid cell, so on `lg` the trip
summary sat in column 2 and the payment card dropped to row 2, column 1. That is most of "ruins
the rest of the UI". The Cloudflare box painting mid-layout was the other half.

A second, quieter bug: `awaitingChallenge` was `!turnstileToken && status !== 'ready'`, which is
`true` on the error path — so the challenge rendered **on top of** the error notice.

---

## What changed

| File | Change |
|---|---|
| `_components/CheckoutGate.tsx` | **New.** The gate: backdrop, step list, sign-in form, Turnstile slot. |
| `_components/Backdrop.tsx` | **New.** Extracted from `CheckoutClient` — gate and page must match pixel for pixel or the photo twitches at handover. |
| `_components/CheckoutClient.tsx` | Gate mounted once, outside every branch. Grid is back to exactly two children. Skeletons dropped (the gate covers them). Visibility predicate fixed. |
| `_lib/useTurnstileToken.ts` | `enabled` option (no token minted before sign-in) + `appearance: 'interaction-only'`. |
| `_lib/errors.ts` | New `auth_required` code, retryable. |
| `checkout/page.tsx` | Reads the better-auth session server-side, passes `viewer`. |
| `api/checkout/route.ts` | **401s without a session.** Sets `customer_email`, adds `userId` to metadata. |
| `components/auth/AuthFormFields.tsx` | New `callbackURL` prop (was hardcoded `"/"`). |
| `api/auth/login-link/route.ts` | Accepts a `callbackURL`, validated. |
| `packages/auth/src/callbackUrl.ts` + `.test.ts` | **New.** Open-redirect guard, 25 tests. |

### The constraint that shapes the gate

`turnstile.reset()` acts on a **live** widget, so its container must stay in the document for the
whole life of the page — including after the gate is gone. The gate therefore **never unmounts**;
`visible` only swaps its classes (`fixed inset-0 z-50` ↔ `size-0 overflow-hidden opacity-0`). Not
`display:none`, not `visibility:hidden`, not a conditional mount — all three tear the widget down.

Being `position: fixed` is also what keeps it out of the grid. That's the layout fix.

### Why auth is enforced twice

The gate is UI, and UI can be bypassed — a request aimed straight at `/api/checkout` never sees it.
`route.ts:184` reads the session cookie itself and 401s. The page-level read is *only* so the gate
knows on first paint whether it owes a sign-in step.

---

## Verified

- `next build` — clean.
- `tsc --noEmit` — clean, both `apps/web` and `packages/auth`.
- `bun test` in `packages/auth` — **43 pass** (my 25 + 18 pre-existing).
- `eslint` — no new errors. (One pre-existing error remains in `components/CookieBanner.tsx`,
  untouched by this work.)
- **In the browser**, against your running dev server on :3002:
  - Signed-out → sign-in gate renders on the blurred hero. No Cloudflare box anywhere.
  - Signed-in (stubbed locally) → step list renders, Turnstile solves **silently with no visible
    widget**, `/api/checkout` returns `auth_required`, and the error notice appears **with the gate
    fully gone**. That last part is the predicate bug, confirmed fixed.
  - Interactive-challenge case → the widget renders **inside the gate card**, centred, with the
    card growing to fit it. This is the case that used to wreck the layout.
  - No console errors.

### Not verified — please check this first tomorrow

**I never saw the two-column ready state.** Reaching it needs a real session, and I can't sign in
(passwords/account creation) or solve the Turnstile challenge that came up. The grid fix is
structurally guaranteed — `<Shell>` now receives exactly `<TripSummary>` and `<PaymentCardBoundary>`
(`CheckoutClient.tsx:326-331`) — but **sign in and look at `/checkout` on a wide screen** to
confirm the summary and payment card sit side by side.

Also unverified: the magic-link and social **return paths**. `callbackURL: '/checkout'` is wired and
the validator is tested, but nobody has actually clicked a link from an inbox or come back from
Google. Worth one real round trip each.

---

## Two things you should know

**1. `TURNSTILE_SETUP.md` lost your uncommitted edits.** At session start it was modified
(+38/−4). Partway through it was gone from the working tree — not by anything I ran, and I have no
explanation. The 38 lines were already unrecoverable by the time I noticed. I restored the
**committed** version so the branch diff stays clean. If those edits mattered, check your editor's
local history.

**2. PostHog is never `identify()`d.** This is the real reason the analytics argument for accounts
didn't hold: the only calls in the codebase are `capture()` and a `posthog.reset()` on sign-out
(`nav.tsx:154`). Today a signed-in user's events are exactly as anonymous as a guest's, so the
account requirement attributes nothing extra on its own. **Adding `identify()` at the existing auth
surfaces is ~5 lines and is the thing actually blocking your attribution** — independent of all of
this, and probably higher value per minute than anything in this commit. (`tirreno` isn't in the
repo at all, so nothing to wire yet.)

---

## Next

1. **Sign in and eyeball the ready state** (see above).
2. **`identify()` on sign-in** — the actual analytics fix.
3. **Booking intents.** `booking.ts:21` still hardcodes `CHECKOUT_BOOKING_ID` to a seeded row. The
   `userId` I put in Stripe metadata (`route.ts:281`) is a placeholder for exactly this: once
   intents are real rows, the intent should carry the user and the webhook should read it from
   there rather than from metadata. There's a `TODO` at that line saying so.
4. **Decide about `account_type`.** Business accounts can't sign into the web app at all —
   `buildAccountTypeHooks` blocks it at the better-auth level — so I did *not* add a check in the
   gate. Confirm that's the behaviour you want at checkout.
5. Delete this file once you've read it.
