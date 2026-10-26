# Handoff: Search result poster card

Oct 26, 2026 · @Wouter

## Overview

The search result card is a portrait "poster": the cover photo fills the whole card, and its bottom fades into a dark tint taken from that same photo, with the text set on top. It replaces the earlier pop-out (cutout) card, which only worked for tall, standalone buildings.

The design is on the [Search result card canvas](https://claude.ai/artifact/NBdp3hj8iAr9LvqCrvayNi). The artboards to build from are **Component · Card**, **States**, **Desktop · results grid**, **Mobile · results list** and **Asset fit**. The illustrated night scenes there are stand-ins for real cover photos.

**Why it looks this way.** The target is a cinematic, dark, premium feel, based on streaming-app poster cards: Hulu's framed poster and Netflix's dot-separated tag line. Luxury comes from what's left out: no grey box under the photo, no coloured badges, no pill tags, and one quiet button.

**In scope:** the card component, its states, the results grid on desktop and the stacked list on mobile, plus the data the card needs (tint, focal point, all-in price).

**Out of scope:** the search bar, filters, sorting, the map view and the property detail page. Those artboards show context only.

## Anatomy and layout

The card is a fixed 2:3 portrait (300 × 450 px at the reference width) built from seven stacked layers. Width is set by the grid; height always follows from `aspect-ratio: 2 / 3`, never from the content.

Layers, back to front:

1. **Tint fill.** The whole card is filled with the photo's stored tint colour, so there is no flash of grey while the photo loads.
2. **Photo.** `object-fit: cover`, with `object-position` set from the stored focal point. It is the only layer that scales on hover.
3. **Scrim.** Two gradients on top of the photo: a soft black fade at the top (behind the save button), and the tint fading in from 34% down the card to solid at the bottom.
4. **Stretched link.** One `<a>` covering the whole card, so the entire card is the click target.
5. **Save button.** Real `<button>`, 44 × 44, pinned 14 px from the top and right. It sits above the link so clicking it doesn't navigate.
6. **Content block.** Anchored to the bottom, 20 px padding on the left, right and bottom. It doesn't take pointer events, so clicks pass through to the link.
7. **Edge ring.** A 1 px inset hairline on the card's border, which brightens on hover.

The content block, top to bottom:

| Element | Content | Spacing above |
| --- | --- | --- |
| Eyebrow | Property type · distance, e.g. `GUESTHOUSE · 0.8 KM FROM CENTRE` | — |
| Title | Property name | 8 px |
| Tag line | Cancellation policy, then up to 2 highlights, joined by `•` | 10 px |
| Divider | 1 px line, full content width | 16 px |
| Price row | Price + unit on the left, "View" on the right, bottom-aligned | 14 px |
| Price detail | Second price line, under the price | 5 px |

The content block grows upwards from the bottom. A two-line title pushes everything above it up into the photo, which is fine because the scrim is already solid by then.

## Design tokens

All colours below are new tokens unless your theme already has an equivalent. The token names are proposals and still need mapping to the existing theme in `packages/ui`, which wasn't checked for this spec. Text on the card is white at fixed opacities, because it always sits on a dark tint, never on the page background.

**Colour**

| Token | Value | Usage |
| --- | --- | --- |
| `bg-results` | `oklch(0.12 0.004 285.8)` | Results page background (one step darker than the `oklch(0.14 …)` app background, so posters lift off it) |
| `card-tint` | per photo, from data | Card fill and the bottom scrim colour |
| `card-tint-fallback` | `#0c0b0d` | Tint when a stay has no stored tint |
| `on-poster` | `#ffffff` | Title, price |
| `on-poster-muted` | `rgb(255 255 255 / 0.78)` | Tag line |
| `on-poster-eyebrow` | `rgb(255 255 255 / 0.74)` | Eyebrow |
| `on-poster-subtle` | `rgb(255 255 255 / 0.66)` | Price detail, price unit (0.72) |
| `poster-divider` | `rgb(255 255 255 / 0.14)` | Divider line |
| `poster-edge` / `-hover` | `rgb(255 255 255 / 0.09)` / `0.22` | Inset edge ring |
| `poster-scrim-top` | `rgb(0 0 0 / 0.38)` → transparent at 20% | Behind the save button |
| `glass-control` | `rgb(10 10 14 / 0.32)`, 1 px border `rgb(255 255 255 / 0.2)`, `backdrop-filter: blur(14px)` | Save button only |
| `cta-on-poster` | bg `#ffffff`, text `#111114` | "View" |

**Type**

| Token | Value | Usage |
| --- | --- | --- |
| `font-display` | Gloock 400 | Title, price |
| `font-ui` | Libre Franklin | Everything else |
| `poster-title` | 28 / 1.08, tracking −0.01em, `text-wrap: balance` | Property name |
| `poster-price` | 26 / 1 | Price |
| `poster-eyebrow` | 11 / 600, uppercase, tracking 0.14em | Eyebrow |
| `poster-body` | 13 / 1.4 | Tag line |
| `poster-caption` | 12 / 1.4 | Price unit, price detail |
| `poster-cta` | 12 / 700, uppercase, tracking 0.12em | "View" |

**Shape, depth and spacing**

| Token | Value | Usage |
| --- | --- | --- |
| `radius-poster` | 18 px | Card |
| `radius-cta` | 6 px | "View" (deliberately square-ish, against the round save button) |
| `shadow-poster` | `0 14px 34px rgb(0 0 0 / 0.45), 0 2px 8px rgb(0 0 0 / 0.3)` | Rest |
| `shadow-poster-hover` | `0 30px 60px rgb(0 0 0 / 0.6), 0 8px 20px rgb(0 0 0 / 0.4)` | Hover / focus |
| `space-poster-x` | 20 px | Content padding, left, right and bottom |
| `space-poster-control` | 14 px | Save button inset |
| `size-touch` | 44 px | Save button, "View" height |

**Scrim gradient** (bottom layer, `T` = `card-tint`):

```css
.poster { --tint: #0c0b0d; background: var(--tint); }
.poster__scrim {
  background:
    linear-gradient(180deg, rgb(0 0 0 / 0.38) 0%, transparent 20%),
    linear-gradient(180deg,
      transparent 0%, transparent 34%,
      color-mix(in oklch, var(--tint) 55%, transparent) 50%,
      color-mix(in oklch, var(--tint) 92%, transparent) 66%,
      var(--tint) 100%);
}
```

Set `--tint` inline per card (`style={{ '--tint': stay.cover.tint }}`). The gradient stays in CSS, so there's no per-card stylesheet.

## Component API and data contract

Build one `StayPosterCard` component and render it from a server component, with only the save button as a client island. The card is purely presentational: it receives a fully priced stay and formats nothing it would have to compute.

**Where it lives.** Put it in `apps/web` (e.g. `apps/web/components/search/stay-poster-card.tsx`), because it depends on search and pricing types. Only the generic parts belong in `packages/ui`: the glass icon button and, if you want to reuse it, the poster scrim.

```ts
type StayPosterCardProps = {
  stay: StaySearchResult;
  priceMode: 'total' | 'night';   // default 'total'; driven by a results-page toggle
  href: string;                   // detail URL with dates + guests carried over
  saved: boolean;
  onToggleSave: (stayId: string) => void;
  priority?: boolean;             // true for the first row: eager image load
};

type StaySearchResult = {
  id: string;
  name: string;
  propertyType: 'hotel' | 'boutique_hotel' | 'guesthouse' | 'bnb' | 'apartment';
  distanceKm: number;             // from the searched place, from PostGIS
  distanceLabel: string;          // e.g. 'centre', the search's reference point
  highlights: string[];           // host-chosen, max 2 shown
  cancellation: { refundable: boolean; freeUntil?: string }; // ISO date
  cover: {
    url: string;                  // R2 / image-CDN base URL
    tint: string;                 // hex, from upload pipeline
    focalX: number;               // 0..1
    focalY: number;               // 0..1
    alt: string;
  } | null;
  availability:
    | { status: 'available'; nights: number; totalMinor: number; currency: 'EUR' }
    | { status: 'unavailable'; nextFrom?: string; nextTo?: string };
};
```

Rules the component relies on:

- `totalMinor` is the **all-in** total for the searched dates and guests, including VAT and tourist tax. The card shows it exactly as given and never adds anything.
- The per-night figure is `Math.round(totalMinor / nights)` and is always labelled *avg*, because rate modifiers can make individual nights differ.
- Format money with `Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })`. Round only for display; never round the total that goes into checkout.
- `highlights` are capped at 2 on the card. The cancellation label is always first and is never dropped.

## States and interactions

The whole card is one link to the stay. The save button is the only other control. Hover and keyboard focus look the same, so keyboard users get the full effect.

| Element | State | Behaviour |
| --- | --- | --- |
| Card | Default | `shadow-poster`, edge ring at 0.09, photo at scale 1 |
| Card | Hover / `:focus-within` | Card moves up 3 px, `shadow-poster-hover`, edge ring 0.22, photo scales to 1.06 from 50% / 40% (a slow push-in) |
| Card | `:focus-visible` on the link | As hover, plus a 2 px white outline, offset 3 px, following the 18 px radius |
| Card | Active (pressed) | Card moves back to 0, no scale change; navigation starts |
| "View" | Hover | Moves up 1 px. It's decoration (`aria-hidden`), not a separate target |
| Save | Unsaved | Outline heart, white stroke 1.8 px |
| Save | Saved | Filled white heart; `aria-pressed="true"` |
| Save | Click | Optimistic toggle. On server error, revert and show a toast ("Couldn't save. Try again."). Must not trigger card navigation |
| Save | Signed out | Opens sign-in, then completes the save after returning. Guests need an account to book anyway |
| Card | Not available for dates | Photo at `grayscale(0.8) brightness(0.6)`. Price row reads "Not available" and "Next free: 4–7 Dec", with an outlined "Dates" in place of "View". The link goes to the detail page with the date picker open. Hover still works |
| Card | Non-refundable | Tag line starts with "Non-refundable". No colour change; nothing on the card is red or green |
| Card | Loading | Skeleton in the same 2:3 frame on `oklch(0.17 0.005 285.8)`: bars for eyebrow, title, tag line, price and button, at the same positions as the real content. No shimmer animation |
| Photo | Loading | The tint fill shows straight away; the photo fades in over 300 ms once decoded |
| Photo | Failed or no cover | Keep the tint (or `card-tint-fallback`) with no image. The text stays fully readable because it never depended on the photo |

Map the "States" artboard on the canvas one-to-one to these rows. It shows default, hover, non-refundable, unavailable and loading.

## Responsive behaviour

The card never changes layout. Only its width changes, and the 2:3 ratio carries the height. The grid decides the column count, so the card needs no breakpoints of its own.

```css
.results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 40px 32px;               /* row, column */
  max-width: 1120px;
  margin-inline: auto;
  padding-inline: 24px;
}
@media (max-width: 639px) {
  .results-grid { grid-template-columns: 1fr; gap: 16px; padding-inline: 16px; }
}
```

| Viewport | Columns | Card width | Notes |
| --- | --- | --- | --- |
| ≥ 892 px | 3 | 260–336 px | Desktop artboard. Content capped at 1120 px, so cards stop growing at 336 px |
| 640–891 px | 2 | 280–405 px | Tablet. Text sizes stay the same; the card just gets wider |
| < 640 px | 1 | full width minus 32 px (358 px on a 390 px phone) | Mobile artboard. One stay at a time, 537 px tall on that phone |

These thresholds come from `minmax(260px, 1fr)` with 24 px side padding and 32 px gaps. Change the 260 and the breakpoints move with it.

Why one column on mobile instead of two: a 2:3 card at \~170 px wide would shrink the title to unreadable sizes. A single column keeps the poster effect and is the pattern streaming apps use.

On touch devices, skip the hover state entirely (`@media (hover: hover)`). It shouldn't get stuck after a tap.

## Motion

Motion is slow and subtle on purpose. The photo push-in is the one cinematic moment, and everything else supports it. Use one shared easing, `--ease-poster: cubic-bezier(0.2, 0.8, 0.2, 1)`.

| Element | Trigger | Animation | Duration | Easing |
| --- | --- | --- | --- | --- |
| Photo | Hover / focus | `scale(1) → scale(1.06)`, origin 50% 40% | 1400 ms | `--ease-poster` |
| Card | Hover / focus | `translateY(0) → (-3px)` + shadow swap | 500 ms | `--ease-poster` |
| Edge ring | Hover / focus | Opacity 0.09 → 0.22 | 400 ms | `ease` |
| "View" | Hover / focus | `translateY(-1px)` | 300 ms | `ease` |
| Photo | Image decoded | Opacity 0 → 1 | 300 ms | `ease-out` |
| Save heart | Toggle | Fill swap, no bounce | 150 ms | `ease` |

Animate only `transform`, `opacity` and `box-shadow`. Put the box-shadow on a pseudo-element and animate its opacity, so a grid of 24 cards doesn't repaint shadows.

Under `prefers-reduced-motion: reduce`: no photo scale and no card lift. Keep the shadow and edge-ring change as the only hover feedback, and drop the image fade to an instant swap.

## Content rules and edge cases

Every text line has a hard cap, so no stay can break the poster's proportions. The photo should always show at least the top 40% of the card.

| Field | Rule | Overflow |
| --- | --- | --- |
| Eyebrow | One line. Type label + distance, e.g. `B&B · 6.2 KM FROM CENTRE` | Truncate with ellipsis |
| Title | Max 2 lines, `text-wrap: balance` | `line-clamp: 2` with ellipsis. Full name stays in the link's accessible name and a `title` attribute |
| Tag line | Cancellation + up to 2 highlights, max 2 lines | Drop the last highlight first, then clamp. Never drop the cancellation label |
| Price | Whole euros, no decimals | Up to 6 digits fits at 300 px; beyond that, reduce to 22 px |
| Price detail | One line | Truncate |

**Copy patterns**

- Distance: `0.8 km from centre` below 10 km (one decimal), `26 km from centre` from 10 km up. The reference point comes from the search (centre, station, a landmark).
- Cancellation: `Free cancellation` when refundable (the date only appears on the detail page, to keep the line short), `Non-refundable` otherwise.
- Price, total mode: `€486 total` with `3 nights · avg €162 / night` below.
- Price, night mode: `€162 avg / night` with `€486 total · 3 nights` below. The total is always visible in both modes.
- Separators: `·` in the eyebrow and price detail, `•` in the tag line.

**Edge cases**

- **No dates searched:** don't show a price. Show `Add dates for prices` in the price row, with "Dates" as the button label. Never show an undated "from €" price; it can't be all-in.
- **No cover photo:** tint fallback, no image. Whether a cover photo is required before a listing can go live is still open (see open questions).
- **Very bright photo:** the scrim is the tint, not black, so a bright photo with a light tint can drop below contrast. The pipeline clamps the tint dark (see the backend section), which is what guarantees readability.
- **Long Dutch or German names:** e.g. "Logement en Bed & Breakfast Het Oude Raadhuis" clamps at 2 lines. Test with names of 40+ characters.
- **Translations:** labels like "Free cancellation" run \~30% longer in Dutch and German ("Kostenlose Stornierung"). The 2-line tag-line cap handles this.
- **Zero results:** not part of the card. The page shows its own empty state.
- **Slow connection:** tint and text render first from the server HTML; the photo streams in after. The card is fully usable before any image arrives.

## Accessibility

Each card is two tab stops, the link and then the save button, and a screen reader hears it as one meaningful sentence instead of a dozen fragments.

**Markup**

```html
<li>
  <article class="poster" aria-labelledby="stay-123-name" style="--tint:#0a0e16">
    <img src="…" alt="" />                      <!-- decorative: the name says what it is -->
    <div class="poster__content">
      <p class="eyebrow">Guesthouse · 0.8 km from centre</p>
      <h3 id="stay-123-name">
        <a href="/stays/123?…" class="poster__link">Huis aan de Gracht</a>
      </h3>
      <p>Free cancellation • Breakfast included • Canal view</p>
      <p><span class="price">€486</span> total</p>
      <p>3 nights · avg €162 / night</p>
      <span aria-hidden="true" class="cta">View</span>
    </div>
    <button type="button" aria-pressed="false" aria-label="Save Huis aan de Gracht">…</button>
  </article>
</li>
```

The link sits inside the `h3` and stretches over the whole card with `::after { position: absolute; inset: 0 }`. This replaces the separate overlay `<a>` in the prototype. The result is that a screen reader's headings list reads as a list of stay names, and the remaining text stays selectable.

**Rules**

- The results are a `<ul>` with an `aria-label` that includes the count ("24 stays in Amsterdam"), so list navigation announces "list, 24 items".
- Focus order: card link, then save, then the next card. The save button comes after the link in the DOM, even though it's drawn at the top.
- Focus ring: 2 px white outline, offset 3 px, on the `::after` overlay so it wraps the whole card. Never `outline: none` without this replacement.
- Cover image `alt=""`: the photo is atmosphere, and the name already identifies the stay. The detail page carries real alt text for its gallery.
- Save button: label includes the stay name; `aria-pressed` reflects the state. After toggling, announce "Saved" or "Removed" through a single shared `aria-live="polite"` region on the page, not one per card.
- Unavailable cards stay focusable and linked, and the word "Not available" is in the text, not just in the grey filter.
- Contrast: on the solid tint (clamped to OKLCH L ≤ 0.16), white at 0.66 is about 8:1, well above 4.5:1. That holds from 66% down the card, where the scrim is 92%+ tint. The eyebrow and a 2-line title can sit higher, at 50–66%, where the photo still shows through. That zone is what to check on real bright photos (acceptance checklist). If it fails, move the 55% stop up from 50% to 44%.
- Touch targets: the save button is 44 × 44; the card itself is far bigger than the minimum.
- Language: set `lang` on stay names that aren't in the page language only if you have the data. Not required for v1.

## Backend and pipeline work

The card needs three things the data layer doesn't produce yet: a tint per cover photo, a poster crop around a focal point, and an all-in total per search result. All three are computed ahead of time, never in the browser.

**1. Cover processing at upload** (runs once per cover photo, as a job on Scaleway Serverless Containers, using `sharp`)

1. Read the original from R2.
2. **Tint:** average the bottom 40% of the image in OKLab, then clamp to L ≤ 0.16 and chroma ≤ 0.04, keeping the hue. Store it as hex. The clamp is what keeps text readable on any photo. It also stops a bright beach shot from producing a light tint.
3. **Focal point:** default `(0.5, 0.4)`. Hosts can override it later by tapping the photo in `apps/business`. Automatic saliency detection is a later improvement.
4. **Poster renditions:** crop to 2:3 around the focal point and write 400×600, 600×900 and 900×1350 as AVIF and WebP back to R2. Cropping on the server keeps files small; a landscape original scaled to fill a 537 px-tall card at 3× would need to be \~2400 px wide.
5. If a host changes the cover or the focal point, rerun the job. Old renditions get new keys, so CDN caches never serve a stale crop.

**Schema** (Drizzle, on the property photos table):

| Column | Type | Notes |
| --- | --- | --- |
| `tint` | `text` | Hex, e.g. `#0a0e16`. Nullable until processed |
| `focal_x`, `focal_y` | `real` | 0–1, default 0.5 / 0.4 |
| `poster_key` | `text` | R2 key prefix for the renditions |
| `processed_at` | `timestamptz` | Null = still processing; the card uses the tint fallback |

Use a `srcset` of the three widths, with `sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 891px) 50vw, 336px"`. Set `fetchpriority="high"` and eager loading on the first row only (`priority` prop); lazy-load the rest.

**2. All-in price in search results**

- The search CTE pipeline (`calculator.ts`) returns `totalMinor` per stay for the searched dates and guest count, in one query. No per-card pricing calls.
- `totalMinor` includes the room total, VAT and the municipality's tourist tax. Tourist tax rules differ per municipality (some are a percentage of the room price, some a fixed amount per person per night), so it needs its own lookup table rather than a single rate.
- Mandatory host fees, such as a cleaning fee, are included too. Optional extras are not.
- Return `availability.status = 'unavailable'` with the next free window, instead of filtering those stays out. Showing them is part of the design.

**3. Distance** comes from PostGIS (`ST_Distance` on `geography`) against the search's reference point, which the search already resolves through Algolia's city lookup.

## Acceptance checklist and open questions

The card is done when every item below passes on real property photos, not the illustrated stand-ins on the canvas.

**Visual and behaviour**

- [ ] Card renders at 2:3 at every grid width from 260 to 405 px, and 358 px on a 390 px phone
- [ ] Tint fill shows before the photo; no grey flash on a throttled "Slow 4G" profile
- [ ] Hover and keyboard focus produce the same effect; nothing sticks after a tap on touch devices
- [ ] Clicking save never navigates; signed-out save goes through sign-in and completes after
- [ ] Unavailable, non-refundable, no-dates and no-cover states match the States artboard
- [ ] 40-character Dutch name and a German tag line clamp cleanly at 2 lines
- [ ] `prefers-reduced-motion` removes the scale and lift

**Accessibility**

- [ ] Each card is 2 tab stops (link, save) in DOM order
- [ ] Screen reader headings list reads as stay names; link name includes the name
- [ ] Eyebrow and title text pass 4.5:1 on the 5 brightest real cover photos in the catalogue (check the 50–66% zone)
- [ ] axe reports zero violations on the results page

**Data and performance**

- [ ] Shown total equals the checkout total for the same dates and guests, tourist tax included
- [ ] Search returns priced results in one query; no per-card requests
- [ ] Only the first row loads eagerly; LCP image is the first card's 600×900 rendition
- [ ] Changing the cover or focal point in `apps/business` updates the card's crop and tint

**Open questions**

- Is a cover photo required before a listing can go live? If yes, the no-cover state only covers broken uploads.
- Should the price toggle (total vs. average per night) persist per user, or reset each search? The default is total, either way.
- Which reference points can a search use for distance (centre, station, landmark), and who picks it when a search is for a whole city?
- Are mandatory host fees (cleaning, linen) already modelled in `calculator.ts`, or is that new work for the all-in total?
- Do the proposed token names fit the existing theme in `packages/ui`, or should they be renamed to match it? The repo wasn't checked for this spec.
