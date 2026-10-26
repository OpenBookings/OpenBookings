# Search Hotel Card Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the search-page hotel card link to the property, show correct rating/price/room data, work on touch, and follow the Glass design system.

**Architecture:** Pure data and formatting logic moves out of the `"use client"` component into two small modules with `bun:test` coverage: `components/search/hotel-card-data.ts` (card type + display formatters) and `lib/search-results.ts` (API result → card mapping, night count). `HotelCard.tsx` becomes presentation only. UI behaviour is verified in the running app (port 3002, `NEXT_PUBLIC_DEMO_DATA=true`). There is no DOM test library in `apps/web`, and none is added.

**Tech Stack:** Next.js 16, React, Tailwind v4, lucide-react, `bun test`.

**Spec:** the design critique from the 2026-10-25 session, condensed into **Findings** below. Executors read this section as the spec.

## Findings (spec)

| # | Finding | Fix |
|---|---|---|
| F1 | Card and "Explore" don't navigate; `cursor-pointer` with no link; `hotel.slug` unused | Stretched `<Link href="/p/{slug}">` on the hotel name covering the card |
| F2 | Rating rounded to an integer (4.6→5), aria says "out of 10" (data is /5), live results show "★ 0" | One decimal + review count; label "out of 5"; hidden when `reviews === 0` |
| F3 | Room line shows "Deluxe Room · · " when bed/size are empty (live data) | Render only non-empty parts |
| F4 | "from €211 /night" even when dates are chosen | Show stay total + "N nights · incl. taxes" when nights are known; keep "from … /night" otherwise. Prices are tax-inclusive (`packages/pricing/src/calculator.ts:457`) |
| F5 | Currency hard-coded to "€"; Chalet Matterhorn is CHF | Format with the result's currency |
| F6 | Gallery arrows hover-only; unusable on touch | Always visible on `(hover: none)` devices, 44px targets |
| F7 | Wishlist heart is 32px and does nothing | Remove it (no wishlist feature exists anywhere in `apps/web`) |
| F8 | Long names truncated, revealed only by a hover tooltip | `line-clamp-2`, delete `TruncatedName` and its portal |
| F9 | City + country pills repeat the location line; "Free cancellation" looks like any other pill | Drop the pills; render cancellation as its own line (positive styling when free) |
| F10 | Location text `white/42` ≈ 4.0:1 contrast (fails AA) | Three-level text scale, nothing below `white/60` |
| F11 | Hard-coded `rgba(0,0,0,0.70)` doubled on card + content, `backdrop-blur-xl`, `#E6C97B` hex, inline door SVG, inline-styled MapPin, mixed pill radii | `bg-black/70 backdrop-blur-md` once; `--color-rating` token; `DoorIcon` in `Icons.tsx`; pills `rounded-full`, buttons `rounded-xl` |
| F12 | Every photo's alt is just the hotel name | "{name}, photo {i} of {n}" when there's more than one |
| F13 | Photo counter text 10px | 11px |
| F14 | Demo cards show the cheapest (non-refundable) price but say "Free Cancellation"; room details come from `rooms[0]`, not the room with that price | Cancellation and room details follow the cheapest rate plan, matching how live results work |

## Global Constraints

- Glass mode rules: `DESIGN_SYSTEM.md` §3.2 (panel/card = `bg-black/70 backdrop-blur-md border-white/20`) and §3.4 (clickable elements are `<a>` or `<button type="button">`; icon-only buttons need `aria-label`).
- Text colour scale on the card: primary `text-white`, secondary `text-white/70`, muted `text-white/60`. No other white alphas for text.
- Money format: `Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 })` → `"€422"`, `"CHF 422"`.
- Copy, exactly: `"incl. taxes"`, `"Free cancellation"`, `"Non-refundable"`, `"from"`, `"/night"`, `"total"`, `"Explore"`.
- The property link carries no query params. `/p/[hotel_slug]` doesn't read dates today (follow-up, out of scope).
- Branch: work in a worktree branched from `feat/web-demo-data` (needs commit `4acdf05` for demo data). Name it `fix/web-hotel-card`. The main checkout has unrelated uncommitted edits. Don't touch them.
- Commits: conventional style `fix(web): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- All commands run from `apps/web`.

## Review Focus

1. **Gallery arrows inside a stretched link:** clicking an arrow must change the photo, not open the property page. → browser check in Task 3, Step 6.
2. **Non-EUR property:** Chalet Matterhorn must show `CHF`, not `€`. → unit tests in Task 1 (`getDemoSearchResults`) and Task 2 (`formatMoney`).
3. **Search with missing or invalid dates** (`/search` with no params, or departure before arrival): falls back to "from … /night", never `NaN` or "0 nights". → `nightsBetween` tests (Task 1), `priceSummary` null-nights test (Task 2).
4. **Live results with no reviews:** no rating badge at all, never "★ 0" or "★ 0.0". → `formatRating(0, 0)` test (Task 2).
5. **Very long hotel name:** wraps to at most 2 lines and doesn't push the rating badge off the card. → browser check in Task 3, Step 7.

---

### Task 1: New card data shape and result mapping

**Files:**
- Create: `apps/web/components/search/hotel-card-data.ts` (type only in this task)
- Create: `apps/web/lib/search-results.ts`
- Test: `apps/web/lib/search-results.test.ts`
- Modify: `apps/web/lib/demo-data.ts` (`getDemoSearchResults`)
- Modify: `apps/web/app/search/page.tsx` (remove `HotelSearchApiResult` + `mapToHotelCardData`, use the new module, pass nights to demo)
- Modify: `apps/web/components/search/HotelCard.tsx` (import type from new file; minimal field renames only)

**Interfaces:**
- Produces, in `hotel-card-data.ts`:
  ```ts
  export type HotelCardData = {
    id: string; name: string; slug: string;
    location: string;            // "Como, IT" (was `distance`)
    rating: number;              // 0–5
    reviews: number;
    price: number;               // per night, tax-inclusive
    totalPrice: number | null;   // whole stay, tax-inclusive; null when nights unknown
    nights: number | null;
    currency: string;            // ISO 4217
    freeCancellation: boolean;   // replaces `tags`
    description: { type: string; bed: string; size: string };
    images: string[];
  };
  ```
- Produces, in `lib/search-results.ts`: `export interface HotelSearchApiResult` (moved verbatim from `page.tsx`), `nightsBetween(checkIn: string, checkOut: string): number | null`, `mapSearchResult(result: HotelSearchApiResult): HotelCardData`.
- Produces, in `demo-data.ts`: `getDemoSearchResults(nights: number | null): HotelCardData[]`.

- [ ] **Step 1: Write the failing tests** in `lib/search-results.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { mapSearchResult, nightsBetween, type HotelSearchApiResult } from "./search-results";
import { getDemoSearchResults } from "./demo-data";

const base: HotelSearchApiResult = {
  hotel_id: "h1", hotel_name: "Hotel Lago", hotel_slug: "hotel-lago", city: "Como", country: "IT",
  hero_image_url: "https://x/a.jpg", room_name: "Lake View Double", room_description: "",
  currency: "EUR", is_refundable: true, total_price: 422, nights: [{ date: "2026-11-10" }, { date: "2026-11-11" }],
};

describe("nightsBetween", () => {
  test("counts nights", () => expect(nightsBetween("2026-11-10", "2026-11-12")).toBe(2));
  test("empty → null", () => expect(nightsBetween("", "")).toBeNull());
  test("same day → null", () => expect(nightsBetween("2026-11-10", "2026-11-10")).toBeNull());
  test("reversed → null", () => expect(nightsBetween("2026-11-12", "2026-11-10")).toBeNull());
  test("garbage → null", () => expect(nightsBetween("soon", "later")).toBeNull());
  test("DST change still whole nights", () => expect(nightsBetween("2026-10-24", "2026-10-26")).toBe(2));
});

describe("mapSearchResult", () => {
  test("maps totals, currency, cancellation", () => {
    expect(mapSearchResult(base)).toMatchObject({
      id: "h1", slug: "hotel-lago", location: "Como, IT", price: 211, totalPrice: 422, nights: 2,
      currency: "EUR", freeCancellation: true, rating: 0, reviews: 0,
      description: { type: "Lake View Double", bed: "", size: "" }, images: ["https://x/a.jpg"],
    });
  });
  test("no nights → per-night only", () => {
    expect(mapSearchResult({ ...base, nights: [] })).toMatchObject({ price: 422, totalPrice: null, nights: null });
  });
  test("non-refundable, no image", () => {
    expect(mapSearchResult({ ...base, is_refundable: false, hero_image_url: null }))
      .toMatchObject({ freeCancellation: false, images: [] });
  });
});

describe("getDemoSearchResults", () => {
  test("totals follow nights and keep the rate currency", () => {
    const chalet = getDemoSearchResults(2).find((h) => h.name === "Chalet Matterhorn")!;
    expect(chalet.currency).toBe("CHF");
    expect(chalet.totalPrice).toBe(chalet.price * 2);
    expect(chalet.nights).toBe(2);
  });
  test("no nights → no total", () => {
    expect(getDemoSearchResults(null).every((h) => h.totalPrice === null && h.nights === null)).toBe(true);
  });
  test("cancellation follows the cheapest plan (non-refundable in every demo property)", () => {
    expect(getDemoSearchResults(null).every((h) => h.freeCancellation === false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun test lib/search-results.test.ts`
Expected: FAIL. Module `./search-results` not found.

- [ ] **Step 3: Implement**
  - `hotel-card-data.ts`: the type above.
  - `search-results.ts`: `nightsBetween` parses both dates as UTC (`Date.UTC` from the `YYYY-MM-DD` parts) so DST can't produce fractional nights. Return `null` unless the result is a positive integer. `mapSearchResult`: `nights = result.nights.length || null`, `price = Math.round(total_price / (nights ?? 1))`, `totalPrice = nights ? Math.round(total_price) : null`.
  - `demo-data.ts`: `getDemoSearchResults(nights)`. `currency` comes from the cheapest rate plan, `totalPrice = nights ? cheapest.bar * nights : null`, `freeCancellation: cheapest.is_refundable`, `description` from the room that owns `cheapest` (not `rooms[0]`), `location` replaces `distance`, no `tags`.
  - `page.tsx`: import from `@/lib/search-results`. Call `getDemoSearchResults(nightsBetween(committed.checkIn, committed.checkOut))`. Map API results with `mapSearchResult`. `HotelCardData` now comes from `@/components/search/hotel-card-data`.
  - `HotelCard.tsx`: delete the local type and import it from `./hotel-card-data`. `hotel.distance` → `hotel.location`. Replace the `hotel.tags.map(...)` pills with one pill reading `"Free cancellation"` or `"Non-refundable"` from `hotel.freeCancellation`, using the same pill classes. This is temporary; Task 4 restyles it.

- [ ] **Step 4: Run the tests and typecheck**

Run: `bun test lib/search-results.test.ts && bun run typecheck`
Expected: all tests pass, `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add components/search/hotel-card-data.ts lib/search-results.ts lib/search-results.test.ts lib/demo-data.ts app/search/page.tsx components/search/HotelCard.tsx
git commit -m "refactor(web): give search cards stay totals, currency and cancellation"
```

---

### Task 2: Display formatters, wired into the card (F2, F3, F4, F5, F12)

**Files:**
- Modify: `apps/web/components/search/hotel-card-data.ts`
- Test: `apps/web/components/search/hotel-card-data.test.ts`
- Modify: `apps/web/components/search/HotelCard.tsx` (rating badge, room line, price block, image alt)

**Interfaces:**
- Consumes: `HotelCardData` (Task 1).
- Produces, in `hotel-card-data.ts`:
  - `formatMoney(amount: number, currency: string): string`
  - `formatRating(rating: number, reviews: number): { value: string; count: string; label: string } | null`
  - `roomDetails(d: HotelCardData["description"]): string[]`
  - `priceSummary(h: Pick<HotelCardData, "price" | "totalPrice" | "nights" | "currency">): { caption: string | null; amount: string; suffix: string; detail: string | null }`
  - `photoAlt(name: string, index: number, total: number): string`

- [ ] **Step 1: Write the failing tests** in `hotel-card-data.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { formatMoney, formatRating, photoAlt, priceSummary, roomDetails } from "./hotel-card-data";

test("formatMoney", () => {
  expect(formatMoney(422, "EUR")).toBe("€422");
  expect(formatMoney(720, "CHF")).toBe("CHF 720");
  expect(formatMoney(211.6, "EUR")).toBe("€212");
});

describe("formatRating", () => {
  test("one decimal, grouped count, /5 label", () =>
    expect(formatRating(4.6, 1243)).toEqual({ value: "4.6", count: "1,243", label: "Rated 4.6 out of 5 from 1,243 reviews" }));
  test("whole numbers keep the decimal", () => expect(formatRating(4, 10)?.value).toBe("4.0"));
  test("singular review", () => expect(formatRating(5, 1)?.label).toBe("Rated 5.0 out of 5 from 1 review"));
  test("no reviews → null", () => expect(formatRating(0, 0)).toBeNull());
  test("bad rating → null", () => expect(formatRating(Number.NaN, 12)).toBeNull());
});

test("roomDetails drops empty parts", () => {
  expect(roomDetails({ type: "Deluxe Room", bed: "", size: "" })).toEqual(["Deluxe Room"]);
  expect(roomDetails({ type: "Lake View Double", bed: "King bed", size: "32 m²" })).toEqual(["Lake View Double", "King bed", "32 m²"]);
});

describe("priceSummary", () => {
  test("stay total when nights known", () =>
    expect(priceSummary({ price: 211, totalPrice: 422, nights: 2, currency: "EUR" }))
      .toEqual({ caption: null, amount: "€422", suffix: "total", detail: "2 nights · incl. taxes" }));
  test("one night", () =>
    expect(priceSummary({ price: 211, totalPrice: 211, nights: 1, currency: "EUR" }).detail).toBe("1 night · incl. taxes"));
  test("per night without dates", () =>
    expect(priceSummary({ price: 211, totalPrice: null, nights: null, currency: "EUR" }))
      .toEqual({ caption: "from", amount: "€211", suffix: "/night", detail: null }));
});

test("photoAlt", () => {
  expect(photoAlt("Hotel Lago", 0, 1)).toBe("Hotel Lago");
  expect(photoAlt("Hotel Lago", 1, 3)).toBe("Hotel Lago, photo 2 of 3");
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun test components/search/hotel-card-data.test.ts`
Expected: FAIL. `formatMoney` isn't exported.

- [ ] **Step 3: Implement the five functions** in `hotel-card-data.ts`. Use the Intl format from Global Constraints. Group the count with `toLocaleString("en-GB")`. `formatRating` returns `null` when `reviews <= 0` or the rating isn't a finite number > 0.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun test components/search/hotel-card-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `HotelCard.tsx`**
  - Rating badge: render only when `formatRating(...)` is non-null. Contents: star, `value`, then `<span className="text-white/60 font-normal">({count})</span>`. Put `aria-label={label}` on the badge.
  - Room line: map `roomDetails(hotel.description)` and put the `·` separator spans between items only.
  - Price block: render `priceSummary(hotel)`. `caption` goes above the amount (existing "from" styling) when non-null. `suffix` sits after the amount (existing "/night" styling). `detail` goes on its own line below at `text-[12px] text-white/60` when non-null.
  - `HotelCardHeroImage`: `alt={photoAlt(hotelName, imageIndex, gallery.length)}`.
  - Delete the `displayRating` rounding.

- [ ] **Step 6: Check in the browser** with the dev server on 3002 at `/search?destination=x&arrival=2026-11-10&departure=2026-11-12&adults=2`:
  - Hotel Lago shows `★ 4.6 (512)` and `€422 total` / `2 nights · incl. taxes`.
  - Chalet Matterhorn shows `CHF 634 total` (317 × 2).
  - Visit `/search` with no params: cards show `from` / `€211` / `/night`, with no detail line.

- [ ] **Step 7: Commit**

```bash
git add components/search/hotel-card-data.ts components/search/hotel-card-data.test.ts components/search/HotelCard.tsx
git commit -m "fix(web): show exact rating, stay total and correct currency on hotel cards"
```

---

### Task 3: Link the card to the property page (F1, F7, F8)

**Files:**
- Modify: `apps/web/components/search/HotelCard.tsx`

**Interfaces:**
- Consumes: `hotel.slug` (Task 1).
- Produces: nothing new. `HotelCard` props are unchanged: `{ hotel: HotelCardData; eager?: boolean }`.

- [ ] **Step 1: Stretched link on the name.** Inside the `<h3>`, render `<Link href={`/p/${hotel.slug}`} className="line-clamp-2 outline-none after:absolute after:inset-0 after:z-0 after:content-['']">{hotel.name}</Link>`. Change the `<h3>` from `leading-tight` to `leading-snug` so two lines breathe. `Card` keeps `relative`. Replace `cursor-pointer` with `has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-white/70`.
- [ ] **Step 2: Delete `TruncatedName`** along with the `createPortal`, `useRef` and `react-dom` imports it alone used.
- [ ] **Step 3: Keep the gallery clickable above the link.** The arrow `Button`s keep `z-10`. Raise the gallery wrapper (`group/image` div) to `relative z-10` so its arrows sit above `after:z-0`. The photo itself stays under the link, so clicking the photo still navigates.
- [ ] **Step 4: Remove the wishlist button** and the `Heart` import.
- [ ] **Step 5: "Explore" becomes visual only.** Replace the `Button` with a `<span aria-hidden="true">` using the same classes, minus the `hover:` and `active:` ones. Add `group-hover:bg-white/20`. The card link is the only interactive target.
- [ ] **Step 6: Check in the browser** at the URL from Task 2:
  - Clicking the card body, the photo or "Explore" lands on `/p/<slug>`. Hotel Lago → `/p/hotel-lago-como`.
  - Hovering the photo and clicking the right arrow moves the counter to `2 / 3` and the URL doesn't change.
  - Tab moves focus to the hotel name link, and the card shows the ring.
- [ ] **Step 7: Long-name check.** In the console, set the first card's link text to `"Grand Hotel Palazzo Sant'Ambrogio della Riviera Lombarda"`. It wraps to 2 lines with an ellipsis and the rating badge stays on the card.
- [ ] **Step 8: Typecheck and commit**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0.

```bash
git add components/search/HotelCard.tsx
git commit -m "fix(web): link search hotel cards to the property page"
```

---

### Task 4: Touch gallery and cancellation hierarchy (F6, F9, F13)

**Files:**
- Modify: `apps/web/components/search/HotelCard.tsx`

**Interfaces:**
- Consumes: `hotel.freeCancellation` (Task 1).

- [ ] **Step 1: Arrows on touch.** Add `[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:size-11` to both arrow buttons. Keep `h-8 w-8` for hover devices.
- [ ] **Step 2: Counter text** goes from `text-[10px]` to `text-[11px]`.
- [ ] **Step 3: Cancellation line.** Replace the interim pill from Task 1 with a `<p>`:
  - When `freeCancellation`: `flex items-center gap-1.5 font-sans text-[13px] font-medium text-emerald-300`, with a lucide `Check` (`size-3.5`, `aria-hidden`) and the copy "Free cancellation".
  - Otherwise: same layout, `text-white/60`, no icon, copy "Non-refundable".

  Delete the amenities wrapper (`aria-label="Hotel amenities"`, `maxHeight: 3.25rem`).
- [ ] **Step 4: Check in the browser**
  - In Chrome DevTools device mode (iPhone 14, touch), the arrows are visible without hover and change photos.
  - Every demo card shows a muted "Non-refundable" line with no city/country pills. All demo cards are on non-refundable prices (F14).
  - To see the green state, temporarily set `freeCancellation: true` in `getDemoSearchResults` and reload. Revert before committing.
- [ ] **Step 5: Commit**

```bash
git add components/search/HotelCard.tsx
git commit -m "fix(web): make card photos browsable on touch and surface free cancellation"
```

---

### Task 5: Align the card with the Glass design system (F10, F11)

**Files:**
- Modify: `apps/web/components/search/HotelCard.tsx`
- Modify: `apps/web/components/Icons.tsx` (add `DoorIcon`)
- Modify: `apps/web/app/globals.css` (`@theme inline`: add `--color-rating`)

**Interfaces:**
- Produces: `export const DoorIcon = ({ className }: { className?: string }) => JSX.Element` in `Icons.tsx`, with the existing door SVG paths moved over unchanged (`fill="currentColor"`, `viewBox="0 0 16 16"`, `aria-hidden`). Produces the Tailwind colour `rating` (`--color-rating: #E6C97B`).

- [ ] **Step 1: Surface.** Delete `CARD_BODY_BG` and every `style={{ backgroundColor }}` that uses it. `Card` gets `bg-black/70 backdrop-blur-md`. Drop `backdrop-blur-xl` from `CardContent` and its background. Drop the image wrapper's background.
- [ ] **Step 2: Token and icons.** Star uses `fill-rating text-rating`. The room line uses `<DoorIcon className="size-4 shrink-0" />`. `MapPin` drops its inline `style` and takes `className="mr-1 size-[13px] shrink-0 opacity-70"`.
- [ ] **Step 3: Text scale.** Name and price use `text-white` (from `/97` and `/95`). The room line stays `text-white/70`. Location, "from", the suffix, the detail line and the review count use `text-white/60` (from `/42` and `rgba(255,255,255,0.52)`).
- [ ] **Step 4: Radius.** The rating badge goes from `rounded-lg` to `rounded-full`. The "Explore" span keeps `rounded-xl`.
- [ ] **Step 4b: Remaining inline values.** Replace the card's arbitrary `shadow-[…rgba…]` and `hover:shadow-[…]` with `shadow-2xl` (Glass surfaces use `shadow-2xl`). Drop the hover shadow change and the `box-shadow` transition. Replace the room line's `style={{ maxHeight: "calc(2 * 1.4em)" }}` with the class `max-h-[2.8em]`.
- [ ] **Step 5: Verify**

Run: `rg -n "rgba\(|#[0-9A-Fa-f]{6}|white/(42|52|95|97)|style=\{" components/search/HotelCard.tsx`
Expected: only the `aspectRatio` style on the image wrapper remains.

Run: `bun test && bun run typecheck && bun run lint`
Expected: all pass.

In the browser at desktop width and in device mode at 390px: the cards look the same as after Task 4 except for the brighter location text and the round rating badge. No horizontal scroll at 390px.

- [ ] **Step 6: Commit**

```bash
git add components/search/HotelCard.tsx components/Icons.tsx app/globals.css
git commit -m "refactor(web): use Glass tokens and shared icons on the hotel card"
```
