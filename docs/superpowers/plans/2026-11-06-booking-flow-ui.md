# Booking Flow Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing property page to the part-1 APIs: dates and guests from the URL, quoted prices and availability, the panel's date/guest fields opening the existing pickers, and Book now creating the hold and opening checkout (signing in first when needed). Owner decision (2026-11-06): no further design work — wiring only; search reason labels, a visible checkout countdown and host-grid copy are dropped.

**Architecture:** The cached property page stays static; a client hook fetches `GET /api/stay-quote` for the URL's stay and merges it into the existing room/rate data. Selection, guest split and Book now live in the existing `RoomsCarousel` / `SelectionSummary`; Book now calls `POST /api/booking-intents` (part 1). Existing overlays (`FocusOverlay` + `Calendar05` / `GuestSelector`, the checkout sign-in form) are reused.

**Tech Stack:** Next.js app router (newer than you know — read `apps/web/node_modules/next/dist/docs` before touching routing/navigation), React 19, framer-motion, Tailwind v4, Bun tests.

**Spec:** `docs/superpowers/specs/2026-11-06-booking-flow-design.md` (see "UI builds on the existing screens; tweaks only"). **Approved concept:** https://claude.ai/artifact/B1FnzYNT3WmNW43DjqPA34 (tweaks 1–10). Part 1 plan: `docs/superpowers/plans/2026-11-06-booking-flow.md`.

## Global Constraints

- **Keep the existing designs; tweaks only.** No new visual language: reuse the components, classes and tokens already in each file (Glass on the property page and search — `bg-black/70 backdrop-blur-md border-white/20`, white-alpha text ladder; Console in checkout — semantic tokens). No new colours except amber for the last 2 minutes of the hold (tweak 8). DESIGN_SYSTEM.md §3.2/§3.3 apply.
- Owner decisions: rooms left shown to guests **only when fewer than 3** ("2 left", "1 left"), never the host's total; the party is **split evenly** over the selected rooms; **rates you can't book are hidden**, a room with no bookable rate is hidden; no room left → one line + "Change dates"; in search, unbookable hotels are hidden except **in testing mode**, where they come last with their reason.
- Property-page URL params: `checkin`, `checkout`, `adults`, `children`, `rooms` (search card links already set them).
- APIs (part 1): `GET /api/stay-quote?property=<slug>&checkin&checkout&adults&children&rooms` → `StayQuote` (`apps/web/lib/booking/quote.ts`); `POST /api/booking-intents` `{ propertyId, checkIn, checkOut, rooms: SelectedRoom[], expectedTotal }` → 201 `{ intentId, holdExpiresAt, checkoutUrl }` | 401 | 400 `{ errors }` | 404 | 409 `{ error: 'price_changed', quote: IntentSnapshot }` | 409 `{ error: 'unavailable', roomIds? , detail? }` | 429.
- Money in euros on the client; show with the file's existing `euro()` formatter.
- Copy: plain, short sentences; no error codes shown to guests.
- Tests: pure logic in small modules with `bun test`; components stay thin. Run from `apps/web`. Commit per task with the attribution lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LJ3U7KVTJ76w2D538Ja1VM
  ```

## Review Focus

1. **Property page opened without dates** (from the home page or an old link) → prices "for today" as now, no crash; Book now opens the date picker instead of posting. Pinned in Task 1 (`stayFromParams returns null without dates`) and Task 4 (`book without stay asks for dates`).
2. **The quote request fails or is slow** → rate rows stay visible with a single line "We couldn't load prices for these dates" and Book now disabled; never stale prices for other dates. Pinned in Task 1 (`merge with failed quote marks unpriced`).
3. **Signed-out guest presses Book now** → sign-in, comes back, booking continues exactly once with the same selection. Pinned in Task 4 (`selection round-trips through the book param`, `pending book param is consumed once`).
4. **Double click on Book now** → one request. Pinned in Task 4 (`book is ignored while pending`).
5. **409 price_changed / unavailable** → the bar shows the new total or which room is gone, selection kept where still valid, no navigation. Pinned in Task 4 (`interpretBookResponse` cases).

---

### Task 1: Stay from the URL and the quote merged into rooms

**Files:**
- Create: `apps/web/app/p/[hotel_slug]/_lib/stay.ts`, `apps/web/app/p/[hotel_slug]/_lib/merge-quote.ts`, `apps/web/app/p/[hotel_slug]/_lib/useStayQuote.ts`
- Test: `apps/web/app/p/[hotel_slug]/_lib/stay.test.ts`, `apps/web/app/p/[hotel_slug]/_lib/merge-quote.test.ts`

**Interfaces:**
- Consumes: `parseStayInput` (`apps/web/lib/booking/stay-input.ts`), `StayQuote`/`QuotedRoom`/`QuotedRatePlan` types (`apps/web/lib/booking/quote.ts`), `DbRoom`/`DbRatePlan` (`app/p/[hotel_slug]/_components/constants.ts`).
- Produces:
  ```ts
  // stay.ts
  export type Stay = { checkIn: string; checkOut: string; nights: number; adults: number; children: number; rooms: number };
  export function stayFromParams(p: URLSearchParams, todayInZone: string): Stay | null; // null when dates missing/invalid
  export function stayToParams(s: Omit<Stay, 'nights'>): URLSearchParams;
  // merge-quote.ts
  export type PricedRate = { ratePlanId: string; stayTotal: number; touristTax: number; total: number; perNight: number; freeCancellationUntil: string | null };
  export type RoomView = { roomId: string; visible: boolean; unitsLeft: number | null; leftCaption: string | null; rates: Record<string, PricedRate | null> };
  export type QuoteState = { status: 'none' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; quote: StayQuote };
  export function mergeQuote(rooms: DbRoom[], state: QuoteState): RoomView[];
  // useStayQuote.ts
  export function useStayQuote(slug: string, stay: Stay | null): QuoteState;
  ```
- Rules: with `none` (no stay) every room/rate is visible with `rates[id] = null` (callers fall back to today's display, as now). With `ready`: a rate is visible only if its quoted plan has no reasons; a room is visible only if it has ≥1 visible rate and no room-level reasons; `leftCaption` = `"2 left"` / `"1 left"` when `unitsLeft` is 1 or 2, else null; `total = stayTotal + touristTax`, `perNight = round2(total / nights)`. With `error` or `loading`: every room visible, `rates` null (Task 2 shows the error line and disables Book). `useStayQuote` aborts the previous request when the stay changes.

- [ ] **Step 1: Failing tests** — `stayFromParams`: valid params → `nights` 3; `checkout <= checkin` → null; past check-in → null; no dates → null (`stayFromParams returns null without dates`); `stayToParams` round-trips. `mergeQuote`: none → all visible, rates null; ready with one plan `['min_stay']` → that rate hidden; room whose every plan has reasons → `visible: false`; `unitsLeft 2` → `"2 left"`, `unitsLeft 3` → null; `merge with failed quote marks unpriced` (error → all visible, rates null); totals: stayTotal 360 + tax 9, 3 nights → total 369, perNight 123.
- [ ] **Step 2: Run** `cd apps/web && bun test 'app/p/[hotel_slug]/_lib'` → FAIL.
- [ ] **Step 3: Implement** the three files (hook: `fetch('/api/stay-quote?…', { signal })`, `cache: 'no-store'`).
- [ ] **Step 4: Run** → PASS; `bun run typecheck` clean.
- [ ] **Step 5: Commit** `Read the stay from the URL and merge its quote into rooms`.

---

### Task 2: Rooms and rates show the quote

**Files:**
- Modify: `apps/web/app/p/[hotel_slug]/_components/RoomsCarousel.tsx`, `apps/web/app/p/[hotel_slug]/page.tsx` (pass `slug`, `propertyId`, `timezone` to `RoomsSection`)

**Interfaces:**
- Consumes: Task 1 (`stayFromParams`, `useStayQuote`, `mergeQuote`, `RoomView`).
- Produces: `RoomsSection` props gain `slug: string; propertyId: string; timeZone: string`. Inside, a `stay` (from `useSearchParams`) and `views: RoomView[]` are available to Tasks 3–4.

Changes (tweaks 1–3; no restyle):
- Remove the hard-coded `BASE_DATE`/`NIGHTS`/`CHECK_IN`/`CHECK_OUT`. The panel's date field shows the stay ("Dec 16 – Dec 20") or "Pick dates"; the guests field shows "2 adults" (+ children) or the default.
- Rate rows: when priced, the big number is `perNight` and the caption stays "per night · incl. tax & fees"; under it, `leftCaption` in the same caption style when set. The `+` stepper is disabled when the room's selected units (all its rates together) reach `unitsLeft`.
- Hidden rates/rooms are not rendered; the carousel's count/nav use visible rooms only. If a stay is set and no room is visible: the rooms area shows one line "Nothing is available for these dates." and a "Change dates" button (opens the Task 3 date overlay).
- Quote `error`: one line under the rates "We couldn't load prices for these dates." and Book now disabled. `loading`: existing skeleton/opacity pattern if one exists, else just disable Book now.
- Selection bar total: priced → Σ qty × `total`, caption "total · N nights · incl. tax"; no stay → keep today's per-night display and caption "Pick your dates".
- Quantities whose rate becomes hidden after a stay change are dropped.

- [ ] **Step 1:** Add the props and wire the hook; remove the constants.
- [ ] **Step 2:** Render rules above. Keep every existing class; only add the caption/empty/error lines using neighbouring caption classes.
- [ ] **Step 3:** `bun run typecheck` and `bun test` in apps/web pass. Manual check (dev server on :3002, TESTING on): `/p/<demo slug>?checkin=<+40d>&checkout=<+43d>&adults=2&rooms=1` shows quoted prices; the last-room hotel shows "1 left"; the min-stay hotel with 3 nights shows the empty line. Note results in the commit message.
- [ ] **Step 4: Commit** `Show quoted prices and availability on the property page`.

---

### Task 3: Date and guest fields open the existing pickers

**Files:**
- Modify: `apps/web/app/p/[hotel_slug]/_components/RoomsCarousel.tsx`
- Create: `apps/web/app/p/[hotel_slug]/_components/StayPickers.tsx`

**Interfaces:**
- Consumes: `FocusOverlay` (`components/plug-in/FocusOverlay.tsx`), `Calendar05` (`components/plug-in/DatePicker.tsx`), `GuestSelector` (`components/plug-in/GuestSelector.tsx`) — copy exactly how `components/search/SearchBar.tsx` opens them; `stayToParams` (Task 1).
- Produces: `StayPickers({ stay, openPanel, onClose, onChange })` where `onChange(next)` replaces the URL (`router.replace(pathname + '?' + params, { scroll: false })`), which re-runs the quote.

- [ ] **Step 1:** Panel date field → date overlay; guests field → guest overlay (adults/children/rooms clamped as the search bar does). Applying writes the URL; nothing else.
- [ ] **Step 2:** "Change dates" (Task 2) opens the date overlay.
- [ ] **Step 3:** typecheck + tests pass; manual: change dates on a demo hotel → prices update without a page reload. **Commit** `Open the date and guest pickers from the room panel`.

---

### Task 4: Guests per room and Book now

**Files:**
- Create: `apps/web/app/p/[hotel_slug]/_lib/split-party.ts`, `apps/web/app/p/[hotel_slug]/_lib/book.ts`
- Modify: `apps/web/app/p/[hotel_slug]/_components/RoomsCarousel.tsx` (`SelectionSummary`)
- Test: `apps/web/app/p/[hotel_slug]/_lib/split-party.test.ts`, `apps/web/app/p/[hotel_slug]/_lib/book.test.ts`

**Interfaces:**
- Consumes: Task 1/2 state; `SelectedRoom` type (`apps/web/lib/booking/quote.ts`); the sign-in form `AuthFormFields` as used in `app/checkout/_components/CheckoutGate.tsx` (reuse its card markup inside `FocusOverlay`, copy "Sign in to book"); session check the way `components/nav.tsx` (or the existing client auth hook) does it.
- Produces:
  ```ts
  // split-party.ts
  export type Unit = { roomId: string; ratePlanId: string; maxAdults: number; maxChildren: number };
  export function splitParty(adults: number, children: number, units: Unit[]):
    { ok: true; rooms: SelectedRoom[] } | { ok: false; reason: 'too_few_rooms' | 'too_many_rooms' | 'does_not_fit'; roomId?: string };
  // book.ts
  export function encodeSelection(sel: Record<string, number>): string;   // "ratePlanId:qty,..."
  export function decodeSelection(s: string | null): Record<string, number>;
  export type BookOutcome =
    | { kind: 'go'; checkoutUrl: string }
    | { kind: 'sign_in' }
    | { kind: 'price_changed'; total: number }
    | { kind: 'unavailable'; roomIds: string[]; message: string }
    | { kind: 'error'; message: string };
  export function interpretBookResponse(status: number, body: unknown): BookOutcome;
  ```
- Rules: `splitParty` deals adults round-robin over units (first unit gets the extra), then children; every unit needs ≥1 adult (`too_many_rooms` when units > adults) and must fit its max (`does_not_fit` + roomId); 0 units → `too_few_rooms`. Bar subline per pick adds guests ("Flexible · 2 adults"). If `ok: false`, the bar shows one line ("Add a room — 2 rooms sleep up to 4" / "One room per adult at most" / "<Room> sleeps 1 adult") and Book now is disabled.
- Book now: no stay → open the date overlay (`book without stay asks for dates`). Otherwise disable the button with the existing pending style and POST `{ propertyId, checkIn, checkOut, rooms, expectedTotal }` (`book is ignored while pending`). Outcomes: `go` → `router.push(checkoutUrl)`; `sign_in` → open the sign-in overlay with `callbackURL` = current URL + `&book=<encodeSelection>`; after sign-in the page sees `book` + a session, restores the quantities, removes `book` from the URL with `router.replace`, then presses Book once (`pending book param is consumed once`); `price_changed` → line "The price changed to €X. Press Book now to continue." and update the shown total; `unavailable` → line "Sorry, <room> was just booked." and drop those rooms' quantities; `error`/400/429/5xx → "Something went wrong. Please try again." — never a code.

- [ ] **Step 1: Failing tests**: splitParty — 4 adults over 2 doubles → [2,2]; 3 adults → [2,1]; 2 adults, 3 units → `too_many_rooms`; 2 adults into a `maxAdults 1` unit alone → `does_not_fit`; children dealt after adults. book — `selection round-trips through the book param`; `interpretBookResponse` for 201, 401, 409 price_changed (total from `quote.total`), 409 unavailable (with and without roomIds), 400, 500.
- [ ] **Step 2: Run** `bun test 'app/p/[hotel_slug]/_lib'` → FAIL.
- [ ] **Step 3: Implement** the two modules, then wire `SelectionSummary` (keep its markup; add the subline guests, the one message line in the bar's existing small-caption style, the pending state). Unit-test the "consumed once" logic as a pure reducer if it doesn't fit in `book.ts` cleanly.
- [ ] **Step 4: Run** → PASS; typecheck clean. Manual (TESTING on, signed out): demo hotel with dates → 2 rooms → Book now → sign in → back → checkout opens for that selection. Signed in: second tab books the last room first → first tab gets "was just booked".
- [ ] **Step 5: Commit** `Book the selected rooms from the property page`.

---
