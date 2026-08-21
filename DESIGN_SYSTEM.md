# OpenBookings Design System

**Status:** proposed — Layer 1 and Layer 2 are descriptive of what already ships; Layer 3 contains open decisions.
**Supersedes:** `.impeccable.md`, `apps/web/DESIGN.md` (both reduced to stubs pointing here).
**Derived from:** `graphify-out/graph.json` (2093 nodes · 3682 edges · commit-pinned) plus direct verification against the working tree. Every rule below cites the node or file it came from.

---

## 0. The central finding

Both existing docs assume the design language divides **by app**: `.impeccable.md` governs `apps/business`, `apps/web/DESIGN.md` governs `apps/web`. The code does not divide that way.

Measured usage of token classes (`bg-card`, `text-muted-foreground`, `border-border`, …) versus raw white/black alpha (`bg-black/70`, `border-white/20`, …):

| Surface | raw alpha | tokens | de-facto language |
|---|---:|---:|---|
| `apps/business/app/(dashboard)` | 0 | 52 | Console |
| `apps/business/components/dashboard` | 0 | 86 | Console |
| `apps/business/components/ui` | 2 | 110 | Console |
| `apps/web/app/checkout` | 0 | 8 | Console |
| `apps/web/components/ui` | 2 | 36 | Console |
| `apps/business/components/business` (marketing) | 131 | 0 | Glass |
| `apps/business/app/(onboarding)` | 104 | 2 | Glass |
| `apps/business/components/auth` | 6 | 0 | Glass |
| `apps/web/app/p/[hotel_slug]` | 253 | 4 | Glass |
| `apps/web/components/plug-in` | 33 | 0 | Glass |
| `apps/web/components/search` | 37 | 0 | Glass |
| `apps/web/components/auth` | 12 | 0 | Glass |

The split is essentially total — every directory is at one pole or the other, with no directory mixing the two. **The real axis is surface mode, not app.** Both apps already contain both modes.

This matters for the glassmorphism conflict the graph audit surfaced. `.impeccable.md`'s anti-reference isn't wrong, it's **mis-scoped**: it was written as an app-wide rule when the pattern it describes is a Console-mode rule. Scoping it to Console resolves `Nav.tsx` and `login-client.tsx` without weakening the rule where it actually earns its keep — the operator tool.

Layer 2 below is therefore organised by **mode**, with an app-level mapping table. Adopting this framing is **Decision D0** in Layer 3.

> This is a re-description of two languages that already exist in the tree, not a third one. Glass = `apps/web/DESIGN.md` §Surfaces. Console = Radix/Twenty tokens in `apps/business/app/globals.css`.

---

## 1. Inventory (evidence base)

### 1.1 UI primitives and duplication

No `packages/ui` exists. `packages/` currently holds `analytics, auth, authz, config, db, mailing, messaging, pricing, stripe`.

`components/ui/` — **11 of 12 web primitives also exist in business** (web has 12 files, business has 31):

| File | web | business | diff (changed lines) | nature of diff |
|---|---:|---:|---:|---|
| `input-group.tsx` | 170 L | 170 L | **0** | byte-identical |
| `select.tsx` | 190 L | 190 L | **0** | byte-identical |
| `skeleton.tsx` | 13 L | 13 L | **0** | byte-identical |
| `textarea.tsx` | 18 L | 18 L | **0** | byte-identical |
| `kbd.tsx` | 28 L | 28 L | 2 | class sort order |
| `label.tsx` | 24 L | 24 L | 2 | class sort order |
| `card.tsx` | 92 L | 92 L | 4 | class sort order |
| `separator.tsx` | 28 L | 28 L | 4 | class sort order |
| `input.tsx` | 21 L | 21 L | 6 | class sort order |
| `button.tsx` | 62 L | 64 L | 14 | class sort order + business adds `xs`/`icon-xs` sizes + `radix-ui` vs `@radix-ui/react-slot` import |
| `map.tsx` | 1285 L | 1850 L | 755 | genuinely diverged (business adds arc/cluster layers) |

Business-only (20): `attachment, avatar, badge, breadcrumb, bubble, checkbox, collapsible, command, dialog, dropdown-menu, field, hover-card, marker, message-scroller, message, sheet, sidebar, table, tabs, tooltip`. Web-only (1): `calendar`.

**Every visual difference in the 10 shared non-map primitives is cosmetic** — Tailwind class sort order (business has been run through `prettier-plugin-tailwindcss`, web hasn't) plus two extra button sizes. There is zero design divergence at the component layer. All real divergence lives in the token layer.

Also duplicated outside `components/ui/`:

| File | Status |
|---|---|
| `components/auth/SS-AuthForm.tsx` | **byte-identical** (32 L each) |
| `components/CookieBanner.tsx` | **byte-identical** |
| `lib/backgrounds.json` | **byte-identical** |
| `lib/utils.ts` (`cn()`) | identical modulo semicolons |
| `components/auth/AuthFormFields.tsx` | 285 L vs 289 L, 99 changed lines — genuinely forked |

Edge counts (god nodes): `cn()` in business = **221 edges** (#1 in the graph), `cn()` in web = **53 edges** (#2). `Button()` business = 15, web = 10. `FocusOverlay()` = 6.

### 1.2 Design token sources

No `tailwind.config.*` in either app — Tailwind v4, CSS-first. Sources are `app/globals.css` (web 459 L, business 542 L) plus `components.json`.

`components.json` is identical except business registers two extra shadcn registries (`@mapcn`, `@blocks-so`). Both: `style: new-york`, `baseColor: neutral`, `cssVariables: true`, `iconLibrary: lucide`.

Fonts loaded via `next/font`:
- `apps/web/app/layout.tsx:2` — **Gloock only**.
- `apps/business/app/layout.tsx:2` — Gloock, Allura, Libre Franklin, Cormorant Garamond, DM Sans.

### 1.3 Doc-level tensions in the graph

`.impeccable.md` contributes 10 semantic nodes, `apps/web/DESIGN.md` contributes 11. Five cross-doc edges connect them:

| Edge | Confidence | Tension |
|---|---|---|
| `Aesthetic Direction: Linear/Vercel x Stripe, Dark Default` → `Glass Surface Recipe (bg-black/alpha + backdrop-blur + border-white/20)` | AMBIGUOUS | **T1 — glassmorphism** (the known one) |
| `Aesthetic Direction…` → `White-on-Dark Alpha Palette` | INFERRED | **T2 — palette**: business has a tokenised Radix/Twenty scale, web has none |
| `Hierarchy Over Uniformity` → `Typography Scale (Gloock serif + Libre Franklin sans)` | INFERRED | **T3 — typography**: business marketing runs Cormorant/DM Sans/Allura, not Gloock/Libre Franklin |
| `Trust Through Density Control` → `FocusOverlay Portal Overlay Pattern` | INFERRED | **T4 — overlays**: web mandates `FocusOverlay`, business uses Radix `dialog.tsx`/`sheet.tsx` |
| `Business-Grade Polish` → `OpenBookings Web Design System` | INFERRED (`rationale_for`) | confirms the docs were meant to share a rationale — supports unification |

A fifth tension is **not** in the doc graph but is visible in code: **T5 — accent colour**. `.impeccable.md` names "cyan-on-dark AI aesthetics" as an anti-reference, yet `#00C8A8` (teal) is used 11 times across `apps/business/components/business/` as the marketing accent, in place of the established blue.

### 1.4 Surface effects by app

`backdrop-blur` — 19 files total:

**business (6 files, 12 usages)**
| File | n | Verdict |
|---|---:|---|
| `components/business/Nav.tsx:11,15,19,23` | 4 | decorative — 4-layer masked blur stack |
| `app/(auth)/login/login-client.tsx:91` | 1 | decorative — `backdrop-blur-xl` over the CDN hero image |
| `app/(onboarding)/_steps/core-info-location.tsx:249` | 1 | functional — map loading scrim |
| `app/(onboarding)/_steps/core-info-location.tsx:263,272` | 2 | decorative — map control chrome, `bg-[#1a1d23]/90` |
| `app/(onboarding)/_steps/legal-n-boring.tsx:46,110` | 2 | functional — `fixed inset-0 z-50` modal scrims |
| `components/ui/dialog.tsx:42` | 1 | functional — Radix overlay scrim |
| `components/ui/map.tsx:149` | 1 | functional — map loading scrim |

**web (13 files, 32 usages)** — `HotelCard.tsx` (6), `RoomsCarousel.tsx` (5), `nav.tsx` (4), `search/page.tsx` (4), `privacy/page.tsx` (3), `GalleryBar.tsx` (2), `plug-in/SearchBar.tsx` (2), and 1 each in `HeroSection.tsx`, `CS-AuthForm.tsx`, `DatePicker.tsx`, `FocusOverlay.tsx`, `GuestSelector.tsx`, `search/SearchBar.tsx`. All Glass-mode by design.

Other surface effects (`.tsx` occurrences):

| | web | business |
|---|---:|---:|
| `shadow-*` | 35 | 41 |
| `bg-gradient/linear/radial` | 7 | 1 |
| `border-white/*` | 100 | 55 |
| `bg-white/*` | 124 | 28 |
| `bg-black/*` | 26 | 2 |
| `ring-*` | 31 | 83 |
| `blur-*` | 34 | 12 |
| hardcoded `[#hex]` | 20 (6 distinct) | 44 (12 distinct) |

---

## 2. Layer 1 — Shared brand foundation

**Rule: these must be identical in both apps.** Where they are not today, the divergence is listed with a recommended resolution. Nothing here is averaged.

### 2.1 Colour primitives

**Current state — divergent.**

`apps/business/app/globals.css:8–48` defines a full, documented, tokenised scale: Radix gray dark P3 (`--gray-1`…`--gray-12`), white-alpha steps (`--gray-a1, a2, a5, a7`), Radix indigoDark accent (`--accent-3, 7, 9, 11`), green/amber status, redDark danger — with sRGB hex in comments and provenance noted (Twenty CRM baseline).

`apps/web/app/globals.css:6–24` defines **no primitives at all** — semantic tokens are assigned raw `oklch()` literals with no scale behind them.

Concrete consequence: `--primary` is `oklch(0.7119 0.0129 286.0684)` in web (near-zero chroma → **grey**) and `var(--accent-9)` = `#3E63DD` in business (**indigo**). The same `<Button>` component, byte-identical apart from class sort order, renders grey in web and blue in business.

**→ Resolution: adopt the business scale as the shared foundation verbatim.** It is the only one of the two that is actually a system, it is documented, and adopting it costs web only its semantic-token block. Web keeps `--chart-2`…`--chart-5`, which are already identical in both files.

Shared brand tokens, currently business-only, move to the foundation:
```
--ob-brand:       oklch(62%   0.21 268)
--ob-brand-light: oklch(67%   0.20 268)
--ob-sidebar:     oklch(10.5% 0.008 262)
```

**Accent is blue.** `.impeccable.md` §Aesthetic Direction: *"Accent color is blue (already established)"*, realised as `--accent-9` / `--ob-brand`. Teal `#00C8A8` is not part of the foundation (see D6).

### 2.2 Type scale

**Current state — divergent, and web has a live bug.**

`apps/web/app/globals.css:37` declares `--font-sans: Libre Franklin, ui-sans-serif, sans-serif, system-ui`, and `apps/web/DESIGN.md` documents Libre Franklin as the body face across the whole app. **`apps/web/app/layout.tsx` never loads it** — only `Gloock` is imported from `next/font/google`. Every `font-sans` surface in `apps/web` currently falls back to `ui-sans-serif` unless the visitor happens to have Libre Franklin installed locally. `apps/business/app/layout.tsx:8` loads it correctly.

Business additionally loads three faces that are **not registered in `@theme inline`** and are therefore reached only via arbitrary-value syntax — e.g. `apps/business/app/page.tsx:12` `font-(family-name:--font-dm-sans)`, `components/business/Hero.tsx:136` `font-(family-name:--font-cormorant)`. They work, but they bypass the token layer entirely.

**→ Resolution:**
1. Load `Libre_Franklin` in `apps/web/app/layout.tsx` and add `libreFranklin.variable` to the `<html>` className. **Straight bug fix, no decision needed.**
2. Foundation faces are **Libre Franklin** (sans / UI) and **Gloock** (serif / display), per `apps/web/DESIGN.md` §Typography and both `@theme inline` blocks.
3. Cormorant Garamond / DM Sans / Allura are a third type system — see **D5**.

Foundation scale, from `apps/web/DESIGN.md` §Typography (unchanged, this table already describes shipped code):

| Role | Classes | Face |
|---|---|---|
| Display / hero | `font-serif text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight` | Gloock |
| Large subheading | `text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight` | Libre Franklin |
| Section label | `text-xl font-semibold tracking-[0.16em] uppercase` | Libre Franklin |
| Body / UI | `text-sm font-medium` | Libre Franklin |
| Caption / meta | `text-xs` | Libre Franklin |
| Tiny label | `text-[11px] uppercase tracking-wide` | Libre Franklin |

### 2.3 Spacing scale

**Current state — already aligned.** Neither app overrides Tailwind's default spacing scale; there is no `--spacing-*` block in either `globals.css`. Keep the Tailwind default.

One shared convention worth promoting from `apps/web/DESIGN.md` §Layout: fixed top-corner elements use `p-4 sm:p-6 md:p-8` so they align across breakpoints.

### 2.4 Radius scale

**Current state — already aligned.** Both `globals.css` files declare `--radius: 0.5rem` and the identical derived block:

```css
--radius-sm: calc(var(--radius) - 4px);  /*  4px */
--radius-md: calc(var(--radius) - 2px);  /*  6px */
--radius-lg: var(--radius);              /*  8px */
--radius-xl: calc(var(--radius) + 4px);  /* 12px */
```

Application differs by mode (Layer 2), not by app. Nothing to fix.

### 2.5 Elevation

**Current state — divergent.**

Web (`globals.css:44–62`) uses a soft ambient set built from `--shadow-x/y/blur/spread/opacity` with `hsl(240 10% 3.9%)`. Business (`globals.css:95–102`) uses the Twenty dark set with `rgba(0,0,0,·)` and a 2px x-offset. Both expose the same eight `--shadow-2xs … --shadow-2xl` names via `@theme inline`, so component code is already portable — only the values differ.

**→ Resolution: adopt the business (Twenty) set as the foundation.** It is tuned for dark backgrounds, which both apps are, and it is the more deliberate of the two. Note the visible consequence: `apps/web/DESIGN.md` §Surfaces mandates `shadow-2xl` on every glass surface, and web's `--shadow-2xl` is a wide soft `-0.5rem`-spread shadow while business's is tighter. Web glass surfaces will read slightly crisper after unification. This is an intended, not incidental, change.

### 2.6 Motion and easing

**Current state — convergent in practice, undocumented in both.**

Measured `.tsx` usage: `transition-colors` dominates both (web 46, business 50). Durations cluster at `duration-200` / `duration-300`; easing is mostly Tailwind default with occasional `ease-out` / `ease-in-out`. Both apps depend on `framer-motion ^12.42.2` and `tw-animate-css ^1.4.0`.

**→ Resolution: codify what is already true.**

| Token | Value | Use |
|---|---|---|
| Default transition | `transition-colors` (150ms, Tailwind default ease) | hover fills, borders, text colour |
| Emphasis | `transition-all duration-200` | CTA buttons, scale/shadow transforms |
| Enter/exit | `duration-300` | overlays, panels, nav reveal |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` must disable looping animation | already honoured for `.tags-scroll` and `.hotel-name-roll` in `apps/web/app/globals.css:410,439` |

Never animate layout properties (width/height) — `apps/web/DESIGN.md` §Do/Don't.

`gsap ^3.15.0` is in `apps/business/package.json:40` with **zero imports anywhere in the tree**. Remove it.

### 2.7 Iconography

**Current state — near-aligned.** Both `components.json` set `"iconLibrary": "lucide"`. Imports: web 14 × `lucide-react`, 2 × `@/components/Icons`. Business 33 × `lucide-react`, 2 × `@tabler/icons-react`.

**→ Resolution: `lucide-react` is the foundation icon set** — it is already the declared library in both `components.json` and carries 47 of 51 imports. Two carve-outs stay legal:
- `apps/web/components/Icons.tsx` — hand-tuned inline SVGs at `stroke="white" strokeWidth={2}`, sized `w-4 h-4 sm:w-5 sm:h-5 shrink-0`, for Glass surfaces where lucide's default weight reads thin over imagery. Per `apps/web/DESIGN.md` §Icons, new Glass icons go here.
- `@tabler/icons-react` — 2 imports in business. Migrate to lucide unless a specific glyph has no lucide equivalent; not worth a decision.

Standing rule, from `apps/web/DESIGN.md` §Icons: never import icons from two sources in the same component.

### 2.8 Dark mode mechanism

**Current state — divergent.** `apps/business/app/globals.css:4` declares `@custom-variant dark (&:is(.dark *))`, making `dark:` class-driven. Web has no such declaration, so its 20 `dark:` utilities resolve against `prefers-color-scheme` instead. Both apps hard-set `className="dark"` on `<html>` and define only a dark palette, so the two behave the same today — but a light-mode visitor's browser preference silently changes which `dark:` rules apply in web only.

**→ Resolution: add the `@custom-variant dark` line to `apps/web/app/globals.css`.** Cheap, removes a latent inconsistency. Both apps stay dark-only for now.

---

## 3. Layer 2 — Application rules by mode

Two modes. Both already exist in the tree. Each app maps its surfaces to one.

| | **Glass** | **Console** |
|---|---|---|
| Optimises for | emotional pull, depth, imagery | density, legibility, operational trust |
| Audience state | browsing, deciding, being persuaded | working, scanning, executing |
| Source of truth | `apps/web/DESIGN.md` §Surfaces / §Colour | `apps/business/app/globals.css` tokens |
| Colour | white-alpha over imagery | semantic tokens (`bg-card`, `text-muted-foreground`) |
| Depth | `backdrop-blur` + translucency + `shadow-2xl` | flat fills, 1px `border-border`, `shadow-xs` at most |
| Radius | `rounded-xl` / `rounded-2xl` | `rounded-md` / `rounded-lg` |
| Type | Gloock display over Libre Franklin body | Libre Franklin throughout, no display serif |
| Density | generous, one decision per view | tight, tabular, many rows in view |

Measured radius usage confirms the split is already real: web skews `rounded-xl` (30) / `rounded-2xl` (18); business skews `rounded-md` (51) / `rounded-lg` (31) with only 5 × `rounded-2xl`.

### 3.1 Surface mapping

| App | Surface | Mode |
|---|---|---|
| `apps/web` | `app/p/[hotel_slug]`, `app/search`, `app/(root)`, `components/plug-in`, `components/search`, `components/auth`, `components/nav.tsx` | **Glass** |
| `apps/web` | `app/checkout`, `components/ui` | **Console** |
| `apps/business` | `app/page.tsx` + `components/business/*` (marketing), `app/(auth)`, `components/auth` | **Glass** — pending D1/D2 |
| `apps/business` | `app/(dashboard)`, `components/dashboard`, `components/ui` | **Console** |
| `apps/business` | `app/(onboarding)` | **contested** — see D3 |

### 3.2 Glass mode

Verbatim from `apps/web/DESIGN.md`, which describes shipped code:

```
bg-black/{opacity}  +  backdrop-blur-{size}  +  border border-white/20
```

| Surface type | Recipe |
|---|---|
| Primary glass (search bar, CTA) | `bg-black/30 backdrop-blur-2xl border-white/20` |
| Panel / card | `bg-black/70 backdrop-blur-md border-white/20` |
| Dense menu | `bg-black/90 backdrop-blur-sm border-white/15` |
| Overlay backdrop | `bg-black/30 backdrop-blur-md` |

Always pair with `rounded-{lg|xl|2xl}` and a shadow. Never a hard opaque background on a Glass surface.

White-alpha ladder — text `white`, `/90`, `/60`, `/50`, `/40`; borders `/20` (default), `/15` (dividers), `/10` (subtle separators).

**Background imagery** (`apps/web/DESIGN.md` §Image & Media, and matched by `apps/business/app/(auth)/login/login-client.tsx:78–89`): served from `https://images.openbookings.co/{path}`, registered in `lib/backgrounds.json` (**byte-identical in both apps**), `bg-cover bg-center bg-no-repeat`, always overlaid with

```css
linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0) 100%)
```

`bg-black` is the loading state — no skeleton, no spinner.

**Overlays:** use `FocusOverlay` (`apps/web/components/plug-in/FocusOverlay.tsx`, 6 edges) — portal into `document.body`, body-scroll lock, close on backdrop click and `Escape`, inner content `max-w-3xl px-6 sm:px-8`. Never hand-roll a modal wrapper on a Glass surface.

**Page scaffold** — full-viewport fixed layers, not a scrolling document:
```
fixed inset-0            → background (z-0)
fixed inset-0 z-10       → hero / main content
fixed top-0 left-0 z-20  → logo
fixed top-0 right-0 z-20 → auth / profile
fixed bottom-* z-50      → primary action bar
z-100                    → FocusOverlay portals
```

### 3.3 Console mode

This is where `.impeccable.md`'s principles apply, restated as enforceable rules:

1. **Precision over decoration** → no `backdrop-blur` except as a functional scrim behind a modal or a loading state. Decorative blur on a Console surface is a defect. *(This is the anti-reference, correctly scoped.)*
2. **Trust through density control** → one clear task per section, progressive disclosure. Tabular data uses `table.tsx`; rows stay tight.
3. **Hierarchy over uniformity** → weight and spacing carry hierarchy, not colour or ornament.
4. **Anxiety reduction at high-stakes moments** → legal signing and Stripe steps get visible save state, undo paths, and unambiguous commit feedback. Graph edge: `Anxiety Reduction at High-Stakes Moments` --`rationale_for`--> `Stripe Bank Details / Legal Signing Onboarding Step`.
5. **Business-grade polish** → no generic-admin defaults; every surface deliberate.

**Colour:** semantic tokens only. Raw `bg-white/*`, `bg-black/*`, `border-white/*` and hardcoded `[#hex]` are not permitted on Console surfaces. Today this rule already holds at 0 violations across `app/(dashboard)`, `components/dashboard`, and `apps/web/app/checkout`.

**Depth:** flat fills plus 1px `border-border`. `shadow-xs` on raised inputs; `shadow-sm` on popovers and cards; nothing heavier.

**Overlays:** Radix — `components/ui/dialog.tsx` and `components/ui/sheet.tsx`. The `backdrop-blur-sm` on `dialog.tsx:42` is a functional scrim and stays. This is the resolution of tension **T4**: `FocusOverlay` is the Glass overlay, Radix Dialog/Sheet is the Console overlay. They are not competitors and neither app should carry both.

**Density:** `size="xs"` / `size="icon-xs"` on `button.tsx` exist for toolbar and grid contexts. Promote both to the shared primitive (§5).

### 3.4 Rules that apply in both modes

From `apps/web/DESIGN.md` §Accessibility — these are not Glass-specific and become foundation policy:

- Interactive `div`s are a bug. Every clickable element is `<button type="button">` or `<a>`.
- Menus: `role="menu"` + `role="menuitem"`; trigger gets `aria-haspopup="menu"` and `aria-expanded`.
- Error banners and toasts: `role="alert"`.
- Icon-only buttons: `aria-label`. Stepper buttons get descriptive labels (`"Increase adults"`).
- Overlays containing a form need a focus trap. **`FocusOverlay` does not trap focus today** — outstanding gap, flagged in `apps/web/DESIGN.md` §Accessibility and still true.
- `select-none` on non-interactive display text (logo, hero copy, avatar).

From `apps/web/DESIGN.md` §Analytics — PostHog event names are `snake_case`, captured for every meaningful interaction, imported from `posthog-js` on the client and `lib/posthog-server.ts` on the server.

---

## 4. Layer 3 — Exception log (decisions for you)

Each item states the violation, the two options, and my recommendation. **I have not resolved any of these.**

---

### D0 — Adopt the mode-based framing

**Finding:** §0. The Glass/Console split is 100% clean across every directory in both apps; the app-level framing in the current docs matches nothing in the code.

**Options:** (a) adopt mode-based framing — `.impeccable.md`'s anti-references become Console rules, `DESIGN.md`'s recipes become Glass rules; (b) keep app-level framing and treat every business marketing/auth/onboarding file as a permanent exception.

**Recommendation: (a).** Option (b) produces a ~25-file standing exception list that grows with every marketing page. Option (a) makes the rule predictive rather than descriptive, and it is what the code already does. **Every decision below assumes D0 = (a); if you pick (b), D1–D4 collapse into "these are all permanent exceptions".**

---

### D1 — `apps/business/components/business/Nav.tsx`

**Violation:** 4 × `backdrop-blur-[24px|12px|6px|2px]` in a masked progressive-blur stack (lines 11–25), plus `bg-white/3`. Direct hit on `.impeccable.md`'s glassmorphism anti-reference. Flagged by the graph audit.

**Context:** imported by exactly one file — `apps/business/app/page.tsx`, the public marketing landing page. It never renders inside the operator tool.

**Options:** (a) reclassify as a Glass surface — no code change; (b) flatten to `bg-background/95 border-b border-border`.

**Recommendation: (a) carve out.** The audience here is a prospect on a marketing page, not an operator mid-shift. `.impeccable.md`'s anti-reference is aimed at the tool, and this file is not the tool. The progressive-blur stack is also genuinely well-built — a masked 4-layer gradient blur, not a default `backdrop-blur-md`. It's the kind of thing "business-grade polish" is asking for. **Condition:** it must stay confined to `components/business/*`; if any dashboard chrome imports it, it comes back for re-decision.

---

### D2 — `apps/business/app/(auth)/login/login-client.tsx`

**Violation:** `backdrop-blur-xl` on the auth container (line 91).

**Context:** stronger than D1. Lines 78–89 implement the **exact** background-image + directional-gradient recipe documented in `apps/web/DESIGN.md` §Image & Media, reading from a `backgrounds.json` that is byte-identical to web's. `components/auth/SS-AuthForm.tsx` is byte-identical to web's. This file is not business-styled code that drifted — it is web's Glass language, deliberately shared, so that a guest and an operator see the same front door.

**Options:** (a) reclassify as Glass; (b) flatten to a Console auth card.

**Recommendation: (a) carve out.** Option (b) would deliberately break a brand-level consistency that someone built on purpose and that the shared assets prove was intentional. Login is pre-authentication — the operator is not yet in the tool, and the anxiety this screen needs to reduce is "is this the right company", which imagery answers better than density does.

---

### D3 — `apps/business/app/(onboarding)/` — the real conflict

**Violation:** 104 raw-alpha usages against 2 token usages across the onboarding route group. `legal-n-boring.tsx` alone has 32 raw-alpha usages plus 2 `backdrop-blur-sm` scrims.

**Why this one is different from D1/D2:** the graph carries an explicit `rationale_for` edge — `Anxiety Reduction at High-Stakes Moments` --> `Stripe Bank Details / Legal Signing Onboarding Step` — and `.impeccable.md` names this exact surface as its *highest-priority* principle. `legal-n-boring.tsx` **is** the legal-signing step. So the file most specifically governed by `.impeccable.md` is also the file furthest from it. D1 and D2 are marketing surfaces the doc arguably never meant to cover; this one it explicitly did.

The user here is also not a prospect. They have signed up, they are authenticated, they are handing over legal documents and bank credentials. That is the Console audience state — working, not browsing.

**Options:** (a) bring onboarding into Console compliance — swap raw alpha for tokens, keep the 2 modal scrims (functional, legal under Console), replace the 3 hardcoded hexes (`#1a1d23`, `#0d1117`, `#13161b`); (b) carve out onboarding as a Glass surface and explicitly downgrade principle 1 of `.impeccable.md`.

**Recommendation: (a) bring into compliance.** This is the largest code change in the log (~5 files, ~104 class swaps) and the one I'd most want you to weigh, because it is also the only place where the two docs give genuinely opposed answers. Note that the onboarding *entry* screens (`layout.tsx`, `AuthLoadingScreen`, `SessionEntryOverlay`) sit closer to D2's login and could reasonably stay Glass — a Glass front door handing off to a Console workspace is a coherent story. But the Stripe and legal steps specifically should be flat, high-contrast, and unambiguous.

---

### D4 — `apps/business/app/(onboarding)/_steps/core-info-location.tsx:263,272`

**Violation:** two map control buttons at `bg-[#1a1d23]/90 backdrop-blur-sm` — hardcoded hex plus decorative blur. The third blur at line 249 is a map loading scrim and is compliant either way.

**Options:** (a) `bg-card/90 border border-border`, dropping the blur; (b) leave as map-widget chrome.

**Recommendation: (a).** Map controls sit over a rendered map, not over photography — the blur buys nothing legibility-wise, and `#1a1d23` is an untokenised near-miss of `--gray-4` (`#1D1D1D`). Cheap fix, no design argument on the other side. Folds into whatever you decide for D3.

---

### D5 — Business marketing type system

**Violation:** `apps/business/components/business/*` and `app/page.tsx` render in **Cormorant Garamond** (13 uses), **DM Sans** (2), and **Allura** (2), reached via `font-(family-name:--font-cormorant)` arbitrary syntax because none of the three are registered in `@theme inline`. `apps/web` marketing renders in **Gloock + Libre Franklin**. Graph tension **T3**.

Two public-facing marketing surfaces for one brand currently use two entirely disjoint type systems, five loaded faces between them.

**Options:** (a) migrate business marketing to Gloock + Libre Franklin and drop Allura, Cormorant, DM Sans from `layout.tsx`; (b) keep them and register `--font-cormorant`, `--font-allura`, `--font-dm-sans` in `@theme inline` as a documented marketing-only extension.

**Recommendation: (a).** This is a brand consistency question, not a mode question — a prospect can land on `openbookings.co` and `business.openbookings.co` in the same session. Five webfonts for one brand is also a real payload cost on the two pages most sensitive to it. That said, (b) is defensible if the business marketing page's visual identity is deliberate and recent; I can't tell intent from the graph, which is why this is yours. **Either way, register the tokens** — arbitrary `font-(family-name:…)` syntax should not be how a brand face is applied.

---

### D6 — Teal `#00C8A8` in business marketing

**Violation:** 11 uses across `Hero.tsx` (4), `RateLock.tsx` (3), `CostCalculator.tsx` (3), `Mechanism.tsx` (1) as the marketing accent — status dots, emphasis text, an inline SVG stroke, a progress fill. `.impeccable.md` §Aesthetic Direction names **"cyan-on-dark AI aesthetics"** as an anti-reference and states the accent **is blue, already established**. Graph tension **T5** — the second doc-level conflict, found in code rather than in the doc graph.

**Options:** (a) replace with `--ob-brand` / `--accent-9` blue; (b) formalise teal as a marketing-only "positive/savings" semantic and add it to the foundation as a named token.

**Recommendation: (a), with a caveat.** Most of the 11 uses are generic emphasis and should be blue. But look at the semantics before you swap globally: `CostCalculator.tsx:182,192` and `RateLock.tsx:77` use teal specifically on savings and commission figures — that's money-positive signalling, which is a legitimate semantic that blue can't carry alongside its role as the interactive accent. If you want to keep it there, take (b) but scope it tightly as `--ob-positive` and remove it from `Hero.tsx`'s decorative dots and arrows. What shouldn't survive either way is an undocumented hex appearing 11 times in violation of the app's own stated anti-reference.

---

### D7 — Extract `packages/ui`?

**Duplication measured:** 10 of 11 shared primitives are cosmetically identical (4 byte-identical); `SS-AuthForm.tsx`, `CookieBanner.tsx`, and `backgrounds.json` are byte-identical; `cn()` differs only in semicolons. Only `map.tsx` (755 changed lines) and `AuthFormFields.tsx` (99) are genuinely forked.

**Recommendation: extract now, scoped to the primitives.**

*Cost/benefit in one line:* the monorepo already has the convention (9 `@openbookings/*` packages on a shared `tsconfig.base.json`), the components are already near-identical so extraction is a move rather than a merge, and the Layer 1 token unification below has to be applied to two copies of every primitive if you defer — which is precisely the drift that produced this document.

Scope: the 10 aligned primitives + `cn()` + `CookieBanner` + `backgrounds.json`. Exclude `map.tsx` (genuinely forked) and `AuthFormFields.tsx` (forked; revisit after D2/D3 settle). Business's 20 extra primitives can move opportunistically as web needs them.

Two costs to accept up front: `shadcn add` writes to `@/components/ui` per `components.json`, so post-extraction the workflow becomes *add into an app, then promote to the package* — worth a line in `CONTRIBUTING`. And web is not currently formatted with `prettier-plugin-tailwindcss` while business is; run it across web before extracting, or the first shared commit will be an unreadable class-reordering diff.

---

## 5. Migration checklist

### Already compliant — no change

- `apps/business/app/(dashboard)/**`, `apps/business/components/dashboard/**` — 0 raw alpha, 52 + 86 token uses.
- `apps/web/app/checkout/**` — 0 raw alpha, 8 token uses.
- `apps/business/components/ui/dialog.tsx:42`, `apps/business/components/ui/map.tsx:149`, `apps/business/app/(onboarding)/_steps/core-info-location.tsx:249`, `apps/business/app/(onboarding)/_steps/legal-n-boring.tsx:46,110` — functional scrims, legal in both modes.
- All 13 `apps/web` `backdrop-blur` files — Glass mode by design.
- `--radius` scale — identical in both apps.
- Spacing scale — Tailwind default in both.
- `components.json` — aligned apart from business's two extra registries (intentional).

### Bug fixes — no decision required

| # | File | Change |
|---|---|---|
| 1 | `apps/web/app/layout.tsx` | Load `Libre_Franklin` via `next/font/google` with `variable: "--font-sans"`; add to `<html>` className. **The documented body face is not currently loaded.** |
| 2 | `apps/web/app/globals.css` | Add `@custom-variant dark (&:is(.dark *));` so `dark:` is class-driven, matching business. |
| 3 | `apps/web/app/globals.css:173–460` | Delete ~290 lines of dead scaffold CSS (`.main-card-wrapper`, `.action-card`, `.profile-picture`, `.loading-state`, `.error-state`, `.button.login`, `.logged-in-section`, …). **Verified zero `.tsx` references.** |
| 4 | `apps/business/app/globals.css:219–505` | Same dead block — it was copied into business too. Delete. |
| 5 | `apps/business/package.json:40` | Remove `gsap ^3.15.0` — zero imports in the tree. |
| 6 | `apps/business/**` (2 files) | Migrate `@tabler/icons-react` imports to `lucide-react`. |
| 7 | `apps/web/**` | Run `prettier-plugin-tailwindcss` to match business's class ordering (prerequisite for D7). |

### Layer 1 unification — code changes

| # | File | Change |
|---|---|---|
| 8 | `apps/web/app/globals.css:6–24` | Replace the untokenised `oklch()` semantic block with business's primitive scale (`--gray-*`, `--gray-a*`, `--accent-*`, status, danger) and the semantic tokens derived from it. **Visible change: `--primary` goes grey → indigo, so every default-variant `<Button>` in web changes colour.** |
| 9 | `apps/web/app/globals.css:44–62` | Replace the shadow set with business's Twenty values. Glass surfaces read slightly crisper (§2.5). |
| 10 | `apps/web/app/globals.css` | Add `--ob-brand`, `--ob-brand-light`, `--ob-sidebar` + their `@theme inline` `--color-*` mappings. |
| 11 | `apps/business/app/globals.css` | Register `--font-cormorant` / `--font-allura` / `--font-dm-sans` in `@theme inline` **if D5 = (b)**; remove the faces from `layout.tsx` if D5 = (a). |

### Decision-gated changes

| Decision | Files | Change if recommendation accepted |
|---|---|---|
| **D0 (a)** | `.impeccable.md`, `apps/web/DESIGN.md` | Reduce both to stubs pointing at this doc's Layer 2 §3.2 / §3.3. |
| **D1 (a)** | `apps/business/components/business/Nav.tsx` | None — annotate as Glass. |
| **D2 (a)** | `apps/business/app/(auth)/login/login-client.tsx` | None — annotate as Glass. |
| **D3 (a)** | `_steps/legal-n-boring.tsx`, `_steps/core-info-text.tsx`, `_steps/core-info-location.tsx`, `_steps/verify.tsx`, `_components/step-nav.tsx`, `(onboarding)/layout.tsx` | ~104 raw-alpha → token swaps; replace `#1a1d23`, `#0d1117`, `#13161b`; keep the 2 modal scrims. **Largest change in the log.** |
| **D4 (a)** | `_steps/core-info-location.tsx:263,272` | `bg-[#1a1d23]/90 backdrop-blur-sm` → `bg-card/90 border border-border`. |
| **D5 (a)** | `apps/business/app/layout.tsx` + 8 files in `components/business/` | Drop Allura/Cormorant/DM Sans; move to `font-serif` (Gloock) / `font-sans` (Libre Franklin). |
| **D6 (a)** | `Hero.tsx`, `RateLock.tsx`, `CostCalculator.tsx`, `Mechanism.tsx` | 11 × `#00C8A8` → `--ob-brand`, or scope a named `--ob-positive` for the 3 money-semantic uses only. |
| **D7 (extract)** | new `packages/ui` | Move 10 primitives + `cn()` + `CookieBanner` + `backgrounds.json`. Exclude `map.tsx`, `AuthFormFields.tsx`. Promote business's `xs` / `icon-xs` button sizes into the shared variant set. |

### Known gaps, tracked but not scheduled

- `FocusOverlay` does not trap focus (`apps/web/DESIGN.md` §Accessibility — still open).
- `apps/web/components/auth/AuthFormFields.tsx` and `apps/business/…/AuthFormFields.tsx` are forked at 99 lines. Revisit after D2 and D3 settle; converging them is likely worthwhile given `SS-AuthForm.tsx` is byte-identical.
- `map.tsx` divergence (755 lines) is genuine feature divergence, not drift. Leave forked.
