# Guest Account Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give signed-in guests on openbookings.co an account area (Bookings, Messages, Personal details, Sign-in & security, Privacy & data, Help & Support, Sign out), reached from a new account dropdown in the nav.

**Architecture:** A new `apps/web/app/account/` route group with a shared layout (top bar + section nav) and one page per top-level tab. Each tab's sub-parts are sections on that page, built the same way as the business app's `/account/security` page (header, `Section` with title/helper/action, `Card` row lists). The account area is a Console surface: it uses the business app's semantic tokens, scoped to a `.console` class so the Glass pages and checkout are not affected. Server reads go through `getServerSession()`; writes go through server actions or Better Auth endpoints.

**Tech Stack:** Next.js 16 app router, React 19, Tailwind v4, shadcn/Radix (copied from `apps/business/components/ui`), Better Auth 1.7.12 (+ `@better-auth/passkey`), `@openbookings/messaging`, `@openbookings/db` (`query`), Lettermint via `@openbookings/mailing`, `bun test`.

**Spec:** this plan. The user asked for the section list in chat and decided: follow the business account page design; phone and address are optional and shared with the host of each booking.

## Global Constraints

- Branch `feat/account-page`, in worktree `../OpenBookings-account`, based on `feat/cancellation-tiers`. Never touch the main checkout's uncommitted WIP.
- EU-only, EUR-only. Dates `en-GB`, money `Intl.NumberFormat('en-NL', { currency: 'EUR' })`.
- Migrations are hand-applied, idempotent SQL in `packages/db/drizzle/` (next number `0028`); mirror in `schema.ts`.
- No endpoint writes ownership SQL from request ids without filtering on the session's user id.
- Every guest-auth change must keep `sessionForApp(..., "private")` as the only session read.
- Copy: plain, short, sentence case. Button labels are verbs.
- PostHog events `snake_case`.

## Review Focus

1. Deleting an account with an upcoming stay → refused with a clear message, nothing deleted (test in Task 8).
2. Changing email to an address that already belongs to a host account → same "check your inbox" response, no leak (Better Auth does this; assert copy does not differ, Task 6).
3. A guest opening `/account/*` while signed out → sign-in prompt, never a crash or another user's data (Task 2).
4. Data export for a guest with zero bookings/messages → valid JSON with empty arrays (test in Task 8).
5. Adding a passkey on a session older than 24 h → refused with "sign in again" copy (test in Task 6).

---

### Task 1: Console tokens, UI primitives, email template

**Files:**
- Modify: `apps/web/app/globals.css` (add Radix primitive tokens to `:root`, add `.console` block overriding semantic tokens with the business values, add `@custom-variant dark`)
- Create: `apps/web/components/ui/{badge,dialog,alert-dialog,dropdown-menu,sonner,spinner,avatar,switch}.tsx` copied from business; replace `button.tsx` with business's (adds `xs`, `icon-xs`)
- Add dep `sonner@^2.0.8` to `apps/web/package.json`
- Create: `apps/web/lib/{device,security-timestamp,passkey-errors}.ts` + tests, copied from business
- Modify: `packages/mailing/src/templates/index.ts` add `"account-action"` template with vars `preheader, eyebrow, headline, body, ctaUrl, ctaLabel, footnote`
- Create: `apps/web/lib/mailing/account-mail.ts` exporting `sendAccountMail(to: string, mail: AccountMail): Promise<void>` and the four builders below.

- [ ] Copy tests along with the libs; `bun test lib/` passes.
- [ ] Test `account-mail.test.ts`: each builder (`emailChangeConfirmation(newEmail, url)`, `newEmailVerification(url)`, `deleteAccountConfirmation(url)`, `passkeyAdded(name, securityUrl)`) returns subject + html containing its URL and HTML-escaped user input.
- [ ] Commit.

### Task 2: Account shell, nav dropdown, `/bookings` redirect

**Files:**
- Create: `apps/web/app/account/layout.tsx` (server; no session → renders sign-in card with `AuthFormFields callbackURL={pathname}`; else top bar + `AccountNav` + children, wrapped in `<div className="console ...">`, plus `<Toaster />`)
- Create: `apps/web/app/account/_components/AccountNav.tsx` (client; desktop vertical list, mobile horizontal scroller; active by `usePathname`; Sign out at bottom)
- Create: `apps/web/app/account/_lib/sections.ts` exporting `ACCOUNT_SECTIONS: { id, title, href, icon }[]` in order: bookings `/account/bookings`, messages `/account/messages`, personal `/account/personal-details`, security `/account/security`, privacy `/account/privacy`, help `/account/help`.
- Create: `apps/web/app/account/_components/{Section,RowList,Row,PendingButton,PageHeader}.tsx` ported from business `security-sections.tsx` / `pending-button.tsx`.
- Create: `apps/web/app/account/page.tsx` → `redirect('/account/bookings')`.
- Create: `apps/web/lib/sign-out.ts` exporting `signOut(router)` (posthog capture `sign_out`, reset, `authClient.signOut()`, `router.replace('/')`).
- Modify: `apps/web/components/nav.tsx` → Radix `DropdownMenu` (Glass dense-menu recipe `bg-black/90 backdrop-blur-sm border-white/15`): header with name/email, one item per `ACCOUNT_SECTIONS`, separator, Sign out. Drop the cookie-status rows.
- Modify: `apps/web/app/bookings/page.tsx` → `redirect('/account/bookings')`.

- [ ] Test `sections.test.ts`: six sections, unique hrefs, all under `/account/`.
- [ ] Typecheck, open `/account` signed out → sign-in card; signed in → nav + bookings.
- [ ] Commit.

### Task 3: Bookings tab (Upcoming / Past / Cancelled)

**Files:**
- Create: `apps/web/app/account/bookings/_lib/list.ts` exporting `GUEST_BOOKINGS_SQL` and `classifyBooking(row, today: string): 'upcoming' | 'past' | 'cancelled'` and `groupBookings(rows, today)`.
- Create: `apps/web/app/account/bookings/page.tsx` (tabs via `?tab=`; default upcoming; cards link to `/bookings/[id]`).

Rules: `cancelled` status → cancelled. `no_show`, `completed`, or `check_out_date < today` → past. `confirmed`/`checked_in` with `check_out_date >= today` → upcoming. `pending` never listed (SQL filters). Upcoming sorted by check-in ascending; past and cancelled by check-in descending.

- [ ] Test `list.test.ts` pins each rule above, including checkout day = today counts as upcoming.
- [ ] Commit.

### Task 4: Messages tab + guest messaging routes

**Files:**
- Create: `apps/web/lib/messaging.ts` (`createMessagingRoutes` bound to guest `sessionForApp(..., "private")`).
- Create routes: `app/api/threads/route.ts` (POST), `app/api/threads/[id]/messages/route.ts` (GET, POST), `app/api/messages/[id]/read/route.ts` (POST), `app/api/realtime/token/route.ts` (POST) — same re-exports as business.
- Create: `app/account/messages/page.tsx` (server query: threads where `guest_id = $1`, property name, last message, unread from host) and `_components/{GuestMessagesView,GuestThreadView}.tsx` ported from business `messages-view`/`thread-view` with `selfRole="guest"`.
- Modify: `app/bookings/[booking-ref]/page.tsx` add "Message the property" button (client: POST `/api/threads {bookingId}` → `router.push('/account/messages?id=…')`).

- [ ] Typecheck; manual: open thread, send, mark read.
- [ ] Commit.

### Task 5: Personal details (name, phone, address) shared with host

**Files:**
- Create: `packages/db/drizzle/0028_guest_profile.sql`: table `guest_profile` (`user_id text PK REFERENCES "user"(id) ON DELETE CASCADE`, `phone varchar(32)`, `address_line1 varchar(200)`, `address_line2 varchar(200)`, `postal_code varchar(20)`, `city varchar(100)`, `country char(2)`, `updated_at timestamptz NOT NULL DEFAULT now()`); mirror in `schema.ts` as `guestProfile`.
- Create: `apps/web/app/account/personal-details/_lib/validate.ts` exporting `parsePersonalDetails(form: FormData): { ok: true; value: PersonalDetails } | { ok: false; errors: Partial<Record<keyof PersonalDetails, string>> }`.
- Create: `.../_lib/actions.ts` `savePersonalDetails(prev, form)` server action (name via `auth.api.updateUser`, rest upserted on `guest_profile` for `session.user.id`).
- Create: page + `_components/PersonalDetailsForm.tsx` (three sections: Name, Phone number, Address; one Save per section).
- Modify: `apps/business/lib/reservations/query.ts` + `shape.ts` + `reservation-detail-panel.tsx` to show guest phone and address (LEFT JOIN `guest_profile`).
- Modify privacy policy: new version folder `apps/web/content/legal/privacy/2026-11-01/en.mdx` (copy 2026-10-03; §2.1 adds optional phone and address, shared with the host of each booking, basis: performance of a contract) — bump through `lib/legal/documents.ts` the way earlier versions were added.

Validation: name 1–100 chars trimmed; phone optional, `^\+?[0-9 ()-]{6,20}$` with ≥6 digits; address all-or-nothing on line1/postal/city/country; country must be an EU/EEA ISO code from a const list; empty strings stored as NULL.

- [ ] Test `validate.test.ts` covers each rule.
- [ ] Commit.

### Task 6: Sign-in & security (email, passkeys, sessions)

**Files:**
- Modify: `packages/auth/src/guest.ts`: add `passkey({ rpID, rpName: "OpenBookings", origin })`, `emailVerification.sendVerificationEmail`, `user.changeEmail { enabled, sendChangeEmailConfirmation }`, `user.deleteUser { enabled, sendDeleteAccountVerification, beforeDelete }` (callbacks injected through `GuestAuthConfig`), and a before-hook `refuseStalePasskeyRegistration(ctx)` for `/passkey/generate-register-options` + `/passkey/verify-registration` (session `createdAt` older than 24 h → 403 `REAUTH_REQUIRED`, "For your security, sign in again to add a passkey."). After-hook on `/passkey/verify-registration` success → `onPasskeyAdded`.
- Create: `packages/auth/src/guest-hooks.ts` + test for the stale-session refusal (pure `isSessionFreshForPasskey(createdAt, now)`, 24 h).
- Modify: `packages/auth/src/client/guest.ts` add `passkeyClient()`.
- Modify: `apps/web/lib/auth.ts` wire the mail builders from Task 1.
- Modify: `apps/web/components/auth/AuthFormFields.tsx`: "Sign in with a passkey" button (`authClient.signIn.passkey`), shown when `PublicKeyCredential` exists.
- Create: `app/account/security/page.tsx` + `_components/{EmailSection,SecurityPanel}.tsx` (port business `security-panel.tsx`, `passkey-dialogs.tsx`, minus step-up and protection card). Email section: current email + "Change email" dialog → `authClient.changeEmail({ newEmail, callbackURL: '/account/security?email=changed' })` → always shows "Check your inbox at <current email> to confirm."

- [ ] Run `bun test packages/auth`.
- [ ] Commit.

### Task 7: Privacy & data — cookie preferences

**Files:**
- Create: `app/account/privacy/page.tsx` + `_components/CookiePreferences.tsx`: shows current analytics choice from `useCookieConsent()` with a `Switch` (on → `accept()`, off → `decline()`), link to the privacy policy.

- [ ] Commit (with Task 8 if small).

### Task 8: Privacy & data — download my data, delete account

**Files:**
- Create: `apps/web/app/account/privacy/_lib/export.ts` exporting `buildGuestExport(userId: string, run = query): Promise<GuestExport>` (profile, guest_profile, bookings + reservations + refunds, message threads + messages, consent_log rows, sessions without tokens, passkeys without public keys).
- Create: `apps/web/app/api/account/export/route.ts` GET → JSON attachment `openbookings-data-YYYY-MM-DD.json`, rate-limited 5/hour per user.
- Create: `apps/web/app/account/privacy/_lib/deletion.ts` exporting `assertCanDeleteAccount(userId, run, today)` (throws `APIError("CONFLICT", { code: "UPCOMING_STAY" })` when any non-cancelled booking has `check_out_date >= today`) and `anonymizeGuestData(userId, run)` (null `consent_log.user_id`, null guest `messages.sender_id`, close guest threads). Wired as `beforeDelete`.
- Delete account UI: danger section, confirm dialog → `authClient.deleteUser({ callbackURL: '/?account=deleted' })` → "Check your inbox to confirm."

Booking rows stay (7-year retention in the privacy policy §4); they keep only the now-orphaned user id.

- [ ] Tests: `export.test.ts` (empty user → empty arrays, no `token`/`publicKey` keys), `deletion.test.ts` (upcoming refused, past-only allowed, checkout today refused).
- [ ] Commit.

### Task 9: Help & Support

**Files:**
- Create: `app/account/help/page.tsx`: sections "Your booking" (links: manage bookings, message the property, cancellation tiers explainer), "Contact us" (support@openbookings.co, privacy@openbookings.co), "Legal" (terms, privacy).

- [ ] Commit.

### Task 10: Verify

- [ ] `bun test` in `apps/web`, `packages/auth`, `apps/business`; `bun run typecheck` and `bun run lint` in `apps/web` and `apps/business`.
- [ ] Run the dev server and click through every tab signed in.
- [ ] Code review of the branch.
