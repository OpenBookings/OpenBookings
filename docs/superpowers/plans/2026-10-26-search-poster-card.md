# Search Poster Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the search page's `HotelCard` with the 2:3 "poster" card from the handoff (cover photo, tint scrim, text over the photo) on today's data, with its states, the results grid, the price toggle and the darker results background.

**Architecture:** Pure data and copy logic lives in `components/search/stay-poster-data.ts` (types and formatters, `bun:test`-covered). `StayPosterCard.tsx` and `StayPosterSkeleton.tsx` only render. `lib/search-results.ts` maps the API row to `StayPosterData`, and `lib/demo-data.ts` produces the same shape. The search API gains one column, `distance_m`. Poster tokens and the scrim gradient go in `apps/web/app/globals.css`. UI behaviour is verified in the running app with `NEXT_PUBLIC_DEMO_DATA=true`. There is no DOM test library in `apps/web`, and none is added.

**Tech Stack:** Next.js 16, React, Tailwind v4, `next/image` (custom Cloudflare loader), PostGIS, `bun test`.

**Spec:** `docs/superpowers/specs/2026-10-26-search-poster-card-handoff.md` (the handoff), plus the canvas at https://claude.ai/artifact/NBdp3hj8iAr9LvqCrvayNi (`Card`, `States`, `Grid` artboards). Read the handoff's **Anatomy**, **Design tokens**, **States**, **Motion** and **Accessibility** sections before Task 3.

## Scope decisions (agreed with Wouter, 2026-10-26)

| Handoff item | This plan |
|---|---|
| Save (heart) button, saved state, sign-in, toast, `aria-live` | **Left out.** No saved-stays feature exists. Each card is one tab stop |
| Tint + focal point from an upload pipeline, schema columns | **Not built.** `cover.tint` is `null` for live data → `#0c0b0d` fallback. Focal point defaults to `(0.5, 0.4)` via `object-position`. Demo data carries hand-picked tints |
| Server-cropped renditions on R2 | **Not built.** Cloudflare Image Transformations already resize; `object-fit: cover` crops |
| Tourist-tax lookup for the all-in total | **Not needed.** Rates are tax-inclusive by contract (`packages/pricing/src/calculator.ts:457`); `total_price` is already all-in |
| Property type in the eyebrow | No such column. The eyebrow uses the location (`Como, IT`) instead |
| Host highlights in the tag line | No suitable data (`property_highlights` holds nearby places). Live → `[]`; demo data gets highlights |
| Unavailable stays with next free window | Card supports it. Live search still filters them out (follow-up). Demo shows Casa Roma as unavailable |
| Distance | **Built:** PostGIS `ST_Distance` in the search query. Demo → `null` (demo results ignore the searched place) |
| Server component | The search page is a client component today. The card is a client component (it tracks image load). No page conversion |
| Detail page opens on date picker for "Dates" | `/p/[slug]` doesn't read params. The link stays `/p/{slug}` (follow-up) |

Removed with the old card: rating badge, photo gallery arrows, room details line, "Highest rated" sort option (the poster shows none of them).

## Global Constraints

- Branch: worktree from `feat/web-demo-data` (HEAD `f333c7c`), named `feat/web-poster-card`. The main checkout has unrelated uncommitted edits; don't touch them. Copy `apps/web/.env.local` into the worktree (gitignored) and run `bun install`.
- Commits: conventional `feat(web): …` / `refactor(web): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `cd apps/web && bun test`. Typecheck: `cd apps/web && bun run typecheck`. Lint: `cd apps/web && bun run lint`.
- Run the app: `cd apps/web && NEXT_PUBLIC_DEMO_DATA=true bun run dev` (port 3002), open `/search?destination=Como&arrival=2026-11-27&departure=2026-11-30&adults=2`.
- Money: `Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 })` (the existing `formatMoney`). Round only for display.
- Copy, exactly: `Free cancellation`, `Non-refundable`, `total`, `avg / night`, `N nights · avg €X / night`, `€X total · N nights`, `Not available`, `Next free: 4–7 Dec`, `Add dates for prices`, `View`, `Dates`, `from centre`. Separators: `·` in eyebrow and price detail, `•` in the tag line, each with one space either side.
- Text colours on the poster are the handoff's white alphas (`/74` eyebrow, `/78` tag line, `/72` price unit, `/66` price detail, `/90` notice heading, `/14` divider). These deliberately differ from `DESIGN_SYSTEM.md` §3.2's ladder; the poster always sits on a dark tint.
- Animate only `transform`, `opacity` and `box-shadow`. Hover effects only under `(hover: hover)` (Tailwind v4's `hover:`/`group-hover:` already do this). Keyboard focus (`:focus-visible` on the link) gets the same effect as hover.

## Review Focus

1. **Cover fails to load** (404, blocked, `null`): card shows the tint and readable text, no broken-image icon, no grey box. → Task 3 step 6, Task 7 step 3.
2. **40+ character name** ("Logement en Bed & Breakfast Het Oude Raadhuis"): title clamps at 2 lines with an ellipsis, price row stays inside the card, photo still visible in the top 40%. → Task 7 step 3.
3. **Non-EUR currency and very large totals**: `CHF 720` formats with the currency code; a 7-digit amount switches to the 22 px size. → Task 1 tests.
4. **Sorting with unavailable or undated stays**: they always sort last, in both price directions. → Task 1 tests.
5. **Keyboard and touch**: one tab stop per card, focus ring wraps the whole card and isn't clipped, Enter navigates; after a tap on a touch device nothing stays lifted. → Task 7 step 2.

---

### Task 1: Poster data model and formatters

**Files:**
- Create: `apps/web/components/search/stay-poster-data.ts`
- Create: `apps/web/components/search/stay-poster-data.test.ts`
- Modify: `apps/web/components/search/hotel-card-data.ts` (remove its `formatMoney`, re-export it from the new module so the old card keeps working until Task 4)
- Modify: `apps/web/components/search/hotel-card-data.test.ts` (move the `formatMoney` test to the new test file)

**Interfaces:**
- Produces (all exported from `stay-poster-data.ts`):

```ts
export type PriceMode = "total" | "night";
export type StayAvailability =
  | { status: "available"; nights: number; total: number; currency: string } // total: all-in, major units
  | { status: "unavailable"; nextFrom?: string; nextTo?: string }             // YYYY-MM-DD, check-in / check-out
  | { status: "undated" };
export type StayCover = { url: string; tint: string | null; focalX: number; focalY: number }; // focal 0..1
export type StayPosterData = {
  id: string; name: string; slug: string;
  location: string;            // "Como, IT"
  distanceKm: number | null;   // from the searched point
  refundable: boolean;
  highlights: string[];
  cover: StayCover | null;
  availability: StayAvailability;
};
export type PosterPrice =
  | { kind: "price"; amount: string; unit: string; detail: string; long: boolean; cta: "View" }
  | { kind: "notice"; heading: string; detail: string | null; cta: "Dates" };

export const POSTER_TINT_FALLBACK = "#0c0b0d";
export const DEFAULT_FOCAL = { x: 0.5, y: 0.4 } as const;

export function formatMoney(amount: number, currency: string): string;          // moved verbatim
export function formatDistance(km: number): string;
export function posterEyebrow(s: Pick<StayPosterData, "location" | "distanceKm">): string;
export function posterTags(s: Pick<StayPosterData, "refundable" | "highlights">): string[];
export function formatDateRange(from: string, to: string): string;
export function posterPrice(a: StayAvailability, mode: PriceMode): PosterPrice;
export function comparePrice(a: StayPosterData, b: StayPosterData, dir: "asc" | "desc"): number;
export function coverPosition(c: Pick<StayCover, "focalX" | "focalY">): string;
export function resultsListLabel(count: number, destination: string): string;
```

- [ ] **Step 1: Write the failing tests** in `stay-poster-data.test.ts`

```ts
const avail = (total: number, nights: number, currency = "EUR") =>
  ({ status: "available", nights, total, currency }) as const;

test("formatMoney", /* the existing formatMoney assertions, moved unchanged */);

describe("formatDistance", () => {
  test("one decimal below 10 km", () => {
    expect(formatDistance(0.8)).toBe("0.8 km");
    expect(formatDistance(6.24)).toBe("6.2 km");
  });
  test("whole km from 10 up, including values that round up to 10", () => {
    expect(formatDistance(9.96)).toBe("10 km");
    expect(formatDistance(26.4)).toBe("26 km");
  });
  test("never shows 0.0", () => expect(formatDistance(0.04)).toBe("0.1 km"));
});

test("posterEyebrow", () => {
  expect(posterEyebrow({ location: "Como, IT", distanceKm: 0.8 })).toBe("Como, IT · 0.8 km from centre");
  expect(posterEyebrow({ location: "Como, IT", distanceKm: null })).toBe("Como, IT");
});

describe("posterTags", () => {
  test("cancellation first, max 2 highlights", () =>
    expect(posterTags({ refundable: true, highlights: ["Breakfast included", "Canal view", "Bikes"] }))
      .toEqual(["Free cancellation", "Breakfast included", "Canal view"]));
  test("non-refundable, blank highlights dropped", () =>
    expect(posterTags({ refundable: false, highlights: ["", "  "] })).toEqual(["Non-refundable"]));
});

test("formatDateRange", () => {
  expect(formatDateRange("2026-12-04", "2026-12-07")).toBe("4–7 Dec");
  expect(formatDateRange("2026-11-30", "2026-12-02")).toBe("30 Nov – 2 Dec");
});

describe("posterPrice", () => {
  test("total mode", () => expect(posterPrice(avail(486, 3), "total")).toEqual({
    kind: "price", amount: "€486", unit: "total", detail: "3 nights · avg €162 / night", long: false, cta: "View" }));
  test("night mode keeps the total visible", () => expect(posterPrice(avail(486, 3), "night")).toEqual({
    kind: "price", amount: "€162", unit: "avg / night", detail: "€486 total · 3 nights", long: false, cta: "View" }));
  test("avg rounds, singular night", () => {
    expect(posterPrice(avail(487, 3), "night")).toMatchObject({ amount: "€162" });
    expect(posterPrice(avail(162, 1), "total")).toMatchObject({ detail: "1 night · avg €162 / night" });
  });
  test("other currencies", () =>
    expect(posterPrice(avail(720, 2, "CHF"), "total")).toMatchObject({ amount: "CHF 720" }));
  test("more than 6 digits → long", () => {
    expect(posterPrice(avail(1_234_567, 3), "total")).toMatchObject({ long: true });
    expect(posterPrice(avail(123_456, 3), "total")).toMatchObject({ long: false });
  });
  test("unavailable with a next window", () =>
    expect(posterPrice({ status: "unavailable", nextFrom: "2026-12-04", nextTo: "2026-12-07" }, "total"))
      .toEqual({ kind: "notice", heading: "Not available", detail: "Next free: 4–7 Dec", cta: "Dates" }));
  test("unavailable without one", () =>
    expect(posterPrice({ status: "unavailable" }, "total")).toMatchObject({ detail: null }));
  test("no dates searched", () => expect(posterPrice({ status: "undated" }, "night")).toEqual({
    kind: "notice", heading: "Add dates for prices", detail: null, cta: "Dates" }));
});

test("comparePrice puts unpriced stays last in both directions", () => {
  // stays a (€300), b (€200), u (unavailable), d (undated) built with a small helper
  expect([u, a, d, b].sort((x, y) => comparePrice(x, y, "asc")).map((s) => s.id)).toEqual(["b", "a", "u", "d"]);
  expect([u, b, d, a].sort((x, y) => comparePrice(x, y, "desc")).map((s) => s.id)).toEqual(["a", "b", "u", "d"]);
});

test("coverPosition clamps to 0–100%", () => {
  expect(coverPosition({ focalX: 0.5, focalY: 0.4 })).toBe("50% 40%");
  expect(coverPosition({ focalX: 1.4, focalY: -0.2 })).toBe("100% 0%");
});

test("resultsListLabel", () => {
  expect(resultsListLabel(24, "Amsterdam")).toBe("24 stays in Amsterdam");
  expect(resultsListLabel(1, "Como")).toBe("1 stay in Como");
  expect(resultsListLabel(4, " ")).toBe("4 stays");
});
```

Unpriced stays keep their original relative order (stable sort, compare returns 0 between them).

- [ ] **Step 2: Run** `cd apps/web && bun test components/search/stay-poster-data.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `stay-poster-data.ts`. `formatDateRange` uses `Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })` on `YYYY-MM-DDT00:00:00Z`; same month → `4–7 Dec` (en dash, no spaces), else `30 Nov – 2 Dec` (spaced en dash). `long` = more than 6 digits in the displayed amount. Move `formatMoney` here; `hotel-card-data.ts` re-exports it.
- [ ] **Step 4: Run** `cd apps/web && bun test` → all PASS (old card tests included).
- [ ] **Step 5: Commit** `feat(web): add poster card data model and formatters`

---

### Task 2: Distance in search results

**Files:**
- Modify: `apps/web/app/api/query/route.ts` (`candidate_rooms` CTE and the final `SELECT`)
- Modify: `packages/pricing/src/calculator.ts` (`RoomRow`)
- Modify: `apps/web/lib/search-results.ts` (`HotelSearchApiResult` only; mapping changes in Task 4)

**Interfaces:**
- Produces: `RoomRow.distance_m?: number` and `HotelSearchApiResult.distance_m?: number`, metres from the searched point. Optional so existing pricing fixtures stay valid. `ResolvedRoom` carries it through unchanged.

- [ ] **Step 1: Add** to `candidate_rooms`: `ST_Distance(p.location::geography, ST_SetSRID(ST_MakePoint(u.lng, u.lat), 4326)::geography) AS distance_m`, and `cr.distance_m` to the final `SELECT`. Same point expression as the existing `ST_DWithin`.
- [ ] **Step 2: Add** `distance_m?: number` with a one-line doc comment to `RoomRow` and `HotelSearchApiResult`.
- [ ] **Step 3: Verify types** `cd apps/web && bun run typecheck` and `cd packages/pricing && bun test` → PASS.
- [ ] **Step 4: Verify the query** with the dev server **without** demo mode: `curl -s 'http://localhost:3002/api/query?lat=45.81&lon=9.08&checkin=2026-11-27&checkout=2026-11-30&adults=2&rooms=1' | jq '.[0].distance_m'` → a number. If the local database is unreachable, record that in the task report and move on (typecheck still guards the shape).
- [ ] **Step 5: Commit** `feat(web): return distance from the searched point in search results`

---

### Task 3: Poster tokens, card and skeleton components

**Files:**
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/components/search/StayPosterCard.tsx`
- Create: `apps/web/components/search/StayPosterSkeleton.tsx`

**Interfaces:**
- Consumes: Task 1 types and `posterEyebrow`, `posterTags`, `posterPrice`, `coverPosition`, `POSTER_TINT_FALLBACK`.
- Produces:
  - `StayPosterCard({ stay, priceMode, href, priority }: { stay: StayPosterData; priceMode: PriceMode; href: string; priority?: boolean })`, a `"use client"` component. It renders a root `<div>` and no `<li>` (the page supplies the `<li>`).
  - `StayPosterSkeleton()` (no props, no state).
  - Tailwind utilities `bg-results`, `bg-poster-skeleton`, `rounded-poster`, `rounded-cta`, `shadow-poster`, `shadow-poster-hover`, `ease-poster`, and the class `.poster-scrim`.

- [ ] **Step 1: Tokens** in `globals.css`. Under `:root`: `--results-background: oklch(0.12 0.004 285.8)`, `--poster-skeleton: oklch(0.17 0.005 285.8)`, `--poster-tint-fallback: #0c0b0d`. Under `@theme inline`: `--color-results`, `--color-poster-skeleton` (pointing at those), `--radius-poster: 18px`, `--radius-cta: 6px`, `--shadow-poster` / `--shadow-poster-hover` (handoff values), `--ease-poster: cubic-bezier(0.2, 0.8, 0.2, 1)`. Add `.poster-scrim` with the handoff's two-gradient background verbatim, using `var(--tint, var(--poster-tint-fallback))` for `T`. There is no `packages/ui`. These names are the mapping of the handoff's proposed tokens onto Tailwind namespaces.

- [ ] **Step 2: Card structure.** The stacking decides whether the stretched link and focus ring work, so follow this exactly:

```
div.group (root)        relative rounded-poster shadow-poster; ::before = shadow-poster-hover at opacity 0 → 1
                        (hover / has-[a:focus-visible]); focus ring here: has-[a:focus-visible]:outline-2
                        outline-offset-3 outline-white (outside the clipped article, follows the radius);
                        motion-safe lift -translate-y-[3px] on hover/focus, motion-safe:active:translate-y-0,
                        transition-transform 500ms ease-poster
└ article               aria-labelledby="stay-{id}-name", style --tint = cover?.tint ?? POSTER_TINT_FALLBACK;
                        relative isolate aspect-[2/3] overflow-hidden rounded-poster bg-(--tint)
                        flex flex-col justify-end font-sans text-white
  ├ div photo wrapper   absolute inset-0 -z-20; opacity 0 → 1 (300ms ease-out) once loaded; motion-reduce:transition-none
  │ └ next/image        fill, alt="", sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 891px) 50vw, 336px",
  │                     object-cover, style objectPosition = coverPosition(cover), origin-[50%_40%],
  │                     motion-safe scale-106 on group hover/focus, 1400ms ease-poster;
  │                     unavailable → grayscale-80 brightness-60; priority → loading="eager" fetchPriority="high",
  │                     else loading="lazy"; onLoad → loaded, onError → failed (stop rendering the image)
  ├ div.poster-scrim    absolute inset-0 -z-10 pointer-events-none, aria-hidden
  ├ div content         NOT positioned (so the link's ::after stretches over the article); pointer-events-none px-5 pb-5
  │   p eyebrow         truncate 11px/600 uppercase tracking-[0.14em] text-white/74  → posterEyebrow
  │   h3#stay-{id}-name mt-2 font-serif text-[28px] leading-[1.08] tracking-[-0.01em] text-balance line-clamp-2
  │     Link {href}     title={name}, pointer-events-auto, focus-visible:outline-none,
  │                     after:absolute after:inset-0 after:z-10 after:content-['']
  │   p tags            mt-2.5 line-clamp-2 text-[13px] leading-[1.4] text-white/78 → posterTags(...).join(" • ")
  │   div divider       mt-4 h-px bg-white/14, aria-hidden
  │   div price row     mt-3.5 flex items-end justify-between gap-3 (see step 3)
  └ div edge ring       absolute inset-0 z-20 pointer-events-none rounded-poster, aria-hidden,
                        inset 1px ring rgb(255 255 255 / 0.09) → 0.22 on hover/focus, transition-shadow 400ms ease
```

"Hover/focus" everywhere means two variants: `group-hover:` and `group-has-[a:focus-visible]:` (on the root itself: `hover:` and `has-[a:focus-visible]:`).

- [ ] **Step 3: Price row** from `posterPrice(stay.availability, priceMode)`:
  - `kind: "price"`: `<p class="flex items-baseline gap-1.5">` with the amount (`font-serif leading-none text-white`, `text-[26px]`, or `text-[22px]` when `long`) and the unit (`text-xs text-white/72`), then `<p class="mt-[5px] truncate text-xs leading-[1.4] text-white/66">` detail.
  - `kind: "notice"`: `<p class="text-[15px] font-semibold text-white/90">` heading, plus the detail line as above when not null.
  - CTA `<span aria-hidden>` on the right, `h-11 shrink-0 rounded-cta text-xs font-bold uppercase tracking-[0.12em] flex items-center`. "View": `bg-white text-[#111114] px-[18px]`. "Dates": `border border-white/50 text-white px-4`. Motion-safe `-translate-y-px` on group hover/focus, 300ms ease.
- [ ] **Step 4: Skeleton**, matching the States artboard: `aria-hidden`, `aspect-[2/3] rounded-poster bg-poster-skeleton shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] p-5 flex flex-col justify-end gap-2.5`. Bars, top to bottom: 58%×10px r4 `white/7`, 80%×26px r6 `white/9`, 70%×12px r4 `white/6`, divider `mt-1.5 h-px white/8`. Then a row (`mt-1 flex items-end justify-between`): a column (`gap-2`) of 90×24px r6 `white/9` and 140×10px r4 `white/6`, and on the right a 72×44px r6 `white/9`. No save circle, no animation.
- [ ] **Step 5: Verify** `cd apps/web && bun run typecheck && bun run lint` → clean.
- [ ] **Step 6: Visual smoke test.** The components aren't on a page until Task 4. Render one `StayPosterCard` and one skeleton temporarily at the top of the search page, with an inline `StayPosterData` (Huis aan de Gracht, €486, 3 nights, Casa Roma's demo image). Check: tint shows before the photo; hovering lifts, zooms and brightens the edge; Tab shows a white ring around the whole card. Then set `cover.url` to `https://cdn.openbookings.co/does-not-exist.jpg` and confirm the tint and text with no broken-image icon. **Remove the temporary render before committing.**
- [ ] **Step 7: Commit** `feat(web): add the search poster card and its skeleton`

---

### Task 4: Feed the poster card and switch the results grid

**Files:**
- Modify: `apps/web/lib/search-results.ts`, `apps/web/lib/search-results.test.ts`
- Modify: `apps/web/lib/demo-data.ts`
- Modify: `apps/web/app/search/page.tsx`
- Delete: `apps/web/components/search/HotelCard.tsx`, `hotel-card-data.ts`, `hotel-card-data.test.ts`

**Interfaces:**
- Consumes: Task 1 types and `comparePrice`, `resultsListLabel`; Task 2 `distance_m`; Task 3 components.
- Produces: `mapSearchResult(r: HotelSearchApiResult): StayPosterData`, `resolveCoverUrl(hotelId: string, url: string): string | null` (moved from `buildHotelImageUrl` in `HotelCard.tsx`, empty → `null`), `getDemoSearchResults(nights: number | null): StayPosterData[]`.

- [ ] **Step 1: Replace the `mapSearchResult` and demo tests** in `search-results.test.ts` (keep `nightsBetween` tests):

```ts
test("maps a priced result", () => expect(mapSearchResult({ ...base, distance_m: 812 })).toEqual({
  id: "h1", name: "Hotel Lago", slug: "hotel-lago", location: "Como, IT", distanceKm: 0.812,
  refundable: true, highlights: [],
  cover: { url: "https://x/a.jpg", tint: null, focalX: 0.5, focalY: 0.4 },
  availability: { status: "available", nights: 2, total: 422, currency: "EUR" },
}));
test("no nights → undated", () =>
  expect(mapSearchResult({ ...base, nights: [] }).availability).toEqual({ status: "undated" }));
test("no image, no distance", () =>
  expect(mapSearchResult({ ...base, hero_image_url: null })).toMatchObject({ cover: null, distanceKm: null }));
describe("resolveCoverUrl", () => {
  test("absolute unchanged", () => expect(resolveCoverUrl("h1", "https://x/a.jpg")).toBe("https://x/a.jpg"));
  test("protocol-relative", () => expect(resolveCoverUrl("h1", "//x/a.jpg")).toBe("https://x/a.jpg"));
  test("relative → CDN under the hotel id", () =>
    expect(resolveCoverUrl("h1", "/rooms/a.jpg")).toBe("https://cdn.openbookings.co/h1/rooms/a.jpg"));
  test("empty → null", () => expect(resolveCoverUrl("h1", "")).toBeNull());
});
describe("getDemoSearchResults", () => {
  test("totals follow nights and keep the rate currency", () =>
    expect(getDemoSearchResults(2).find((s) => s.name === "Chalet Matterhorn")!.availability)
      .toEqual({ status: "available", nights: 2, total: 634, currency: "CHF" })); // non-refundable bar round(360 × 0.88) = 317
  test("Casa Roma is unavailable, dated or not", () => {
    for (const n of [2, null]) expect(getDemoSearchResults(n).find((s) => s.name === "Casa Roma")!.availability.status).toBe("unavailable");
  });
  test("no nights → others undated", () =>
    expect(getDemoSearchResults(null).filter((s) => s.name !== "Casa Roma").every((s) => s.availability.status === "undated")).toBe(true));
  test("every demo cover has a tint; no demo distance", () =>
    expect(getDemoSearchResults(2).every((s) => s.cover?.tint && s.distanceKm === null)).toBe(true));
  test("cancellation follows the cheapest plan", () =>
    expect(getDemoSearchResults(null).every((s) => s.refundable === false)).toBe(true));
});
```

- [ ] **Step 2: Run** `cd apps/web && bun test lib/search-results.test.ts` → FAIL.
- [ ] **Step 3: Implement the mapping.** `distanceKm = distance_m / 1000` when `distance_m` is a finite number, else `null`. Cover focal values are `DEFAULT_FOCAL`. Demo: extend `demoProperty`'s `extra` with `highlights`, `tint` and an optional `unavailable: true`. Values: Terme di Saturnia `["Thermal pools", "Medical spa"]`, `#14100c`. Hotel Lago `["Lakefront", "Mountain views"]`, `#0a0f16`. Casa Roma `["Near the Pantheon"]`, `#120e0c`, unavailable. Chalet Matterhorn `["Ski-in, ski-out", "Mountain views"]`, `#0b0e12`. The demo cover is the hero image. Keep `rating`/`reviews` on `DemoProperty` if anything else reads them; otherwise remove them.
- [ ] **Step 4: Run** `cd apps/web && bun test lib/search-results.test.ts` → PASS.
- [ ] **Step 5: Switch the page** (`app/search/page.tsx`):
  - State holds `StayPosterData[]`. Add `const [priceMode] = useState<PriceMode>("total")` (the toggle comes in Task 5).
  - Sorting: `price_asc` / `price_desc` use `comparePrice`. Remove the `rating` option and its `<SelectItem>`.
  - Page wrapper padding `px-10` → `px-4 sm:px-6`.
  - Replace the cards `div` with `<ul aria-label={resultsListLabel(n, committed.destination)} className="mx-auto grid w-full max-w-[1072px] grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] sm:gap-x-8 sm:gap-y-10">`. Each `<li key={id}>` wraps `<StayPosterCard stay priceMode href={`/p/${slug}`} priority={index < 3} />`. 1072 = the handoff's 1120 minus the 24 px side padding the page now provides, which gives 3 columns from 892 px, 2 from 640 px and 1 below.
  - While `isLoading`: the same `<ul>` with `aria-busy="true"` and six `<li><StayPosterSkeleton /></li>`. The empty-state message is unchanged and is never shown inside an empty `<ul>`.
  - Delete `HotelCard.tsx`, `hotel-card-data.ts`, `hotel-card-data.test.ts`. `rg "hotel-card-data|HotelCard" apps/web --glob '!node_modules' --glob '!.next'` → no hits.
- [ ] **Step 6: Verify** `bun test && bun run typecheck && bun run lint` → clean. In the running app: 4 posters, Casa Roma greyed out with "Not available" and an outlined "Dates" button. With the dates removed from the URL: "Add dates for prices" on the others. Sorting by price keeps Casa Roma last both ways. The skeleton shows while a live search loads (throttle the network in devtools).
- [ ] **Step 7: Commit** `feat(web): show search results as poster cards`

---

### Task 5: Total / per-night price toggle

**Files:**
- Modify: `apps/web/app/search/page.tsx`

**Interfaces:**
- Consumes: `PriceMode`; the `priceMode` state from Task 4 gets its setter.

- [ ] **Step 1: Add the control** in the results bar, before Filters: `<div role="group" aria-label="Show prices as">` holding two `<button type="button" aria-pressed>` labelled `Total` and `Per night`. Container styled like the Filters button (`h-9 rounded-xl border border-white/20 bg-white/10 p-0.5 backdrop-blur-sm`); pressed button `rounded-[10px] bg-white text-[#111114]`, unpressed `text-white/80 hover:text-white`, both `px-3 text-sm transition-colors`. Default `total`; not persisted (open question in the handoff).
- [ ] **Step 2: Verify** in the app: toggling switches every card between `€792 total` / `3 nights · avg €264 / night` and `€264 avg / night` / `€792 total · 3 nights` (Terme di Saturnia, 3 nights, cheapest plan €264). `aria-pressed` flips. Typecheck and lint are clean.
- [ ] **Step 3: Commit** `feat(web): let guests switch between total and per-night prices`

---

### Task 6: Results page background

**Files:**
- Modify: `apps/web/app/search/page.tsx`

- [ ] **Step 1: Replace** the fixed background layer (backdrop `Image` + blur + 70% black) with `<div className="fixed inset-0 bg-results" />`. Remove the `useBackdrop` call and any now-unused imports from this page only. The hook stays; `app/page.tsx` still uses it.
- [ ] **Step 2: Verify** in the app: flat `oklch(0.12 …)` background, posters lift off it, search bar and results bar still readable. Typecheck and lint are clean.
- [ ] **Step 3: Commit** `feat(web): use the darker results background behind poster cards`

---

### Task 7: Acceptance pass in the browser

No code unless a check fails. A failure goes back to the owning task's file, as its own `fix(web): …` commit.

- [ ] **Step 1: Widths.** Responsive mode at 1280, 892, 891, 640, 639 and 390 px. Column counts 3/3/2/2/1/1. Every card stays 2:3 (`getBoundingClientRect` height ÷ width = 1.5 ± 0.01). At 390 px the card is 358 px wide.
- [ ] **Step 2: Keyboard, touch and motion.** Tab from the sort control: exactly one stop per card, in DOM order. The ring wraps the whole card (not clipped), and the lift, zoom and edge match hover. Enter opens `/p/{slug}`. Touch emulation: tap-and-back leaves no card lifted. With `prefers-reduced-motion: reduce` emulated: no zoom and no lift, but shadow and edge still change.
- [ ] **Step 3: Content stress test** via devtools on a rendered card: set the title to "Logement en Bed & Breakfast Het Oude Raadhuis" → 2 lines with an ellipsis, price row inside the card. Tag line "Kostenlose Stornierung • Frühstück inklusive • Blick auf den Kanal" → 2 lines max, starting with the cancellation label. Point an image `src` at a missing file → tint and text, no broken icon.
- [ ] **Step 4: Loading.** "Slow 4G" throttle, hard reload: tint and text appear before the photos, with no grey flash. In the Network panel, only the first three cover images are requested before scrolling.
- [ ] **Step 5: Final checks** `bun test && bun run typecheck && bun run lint` in `apps/web`, plus `bun test` in `packages/pricing`. Report anything skipped (for example, Task 2's live query if there was no database). axe isn't installed. Note that in the report instead of adding it.
