# Design System — OpenBookings Web

Baseline design rules for every page. Follow these instead of inventing new values. Add to this file whenever a new pattern is established.

---

## Typography

| Role | Tailwind | Font | Notes |
|------|----------|------|-------|
| Display / hero heading | `font-serif text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight` | Gloock (serif) | Page-level hero titles only |
| Large subheading | `text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight` | Libre Franklin | Paired under display heading |
| Section label | `text-xl font-semibold tracking-[0.16em] uppercase text-white/60` | Libre Franklin | Overlay panel section headers |
| Body / UI text | `text-sm font-medium` | Libre Franklin | Search fields, menu items, buttons |
| Caption / meta | `text-xs text-white/60` | Libre Franklin | Subtitles, age ranges, status text |
| Tiny label | `text-[11px] uppercase tracking-wide text-white/50` | Libre Franklin | Dropdown category headings |

**Font stack** (from `globals.css`):
- Sans: `Libre Franklin, ui-sans-serif, sans-serif`
- Serif: `Gloock, serif` (loaded via `--font-gloock` next/font variable)
- Mono: `monospace`

Text on dark/photo backgrounds gets an inline text shadow for legibility:
```
textShadow: "0 2px 24px rgba(0,0,0,0.85), 0 1px 6px rgba(0,0,0,0.6)"
```
Apply this only on hero copy placed directly over imagery.

---

## Color & Opacity

The palette is almost entirely **white-on-dark with alpha**. Avoid hardcoded hex colors on new surfaces; use the opacity scale below.

### White alpha (text & borders on dark surfaces)

| Token | Value | Use |
|-------|-------|-----|
| `text-white` | `rgba(255,255,255,1.0)` | Primary active text, selected values |
| `text-white/90` | `rgba(255,255,255,0.9)` | Profile menu body text |
| `text-white/60` | `rgba(255,255,255,0.6)` | Secondary UI labels |
| `text-white/50` | `rgba(255,255,255,0.5)` | Tertiary labels, category headings |
| `text-white/40` | `rgba(255,255,255,0.4)` | Placeholder / empty state text |
| `text-gray-300` | — | Hero subheading |
| `border-white/20` | `rgba(255,255,255,0.2)` | Standard glass border |
| `border-white/15` | `rgba(255,255,255,0.15)` | Dividers inside containers |
| `border-white/10` | `rgba(255,255,255,0.1)` | Subtle separators, list item borders |

### Background fills

| Token | Value | Use |
|-------|-------|-----|
| `bg-black/30` | `rgba(0,0,0,0.3)` | Primary glass surface (search bar, CTA button) |
| `bg-black/50` | `rgba(0,0,0,0.5)` | Dropdown results panel |
| `bg-black/60` | `rgba(0,0,0,0.6)` | Error/alert banners |
| `bg-black/70` | `rgba(0,0,0,0.7)` | Input forms, cards inside overlays |
| `bg-black/90` | `rgba(0,0,0,0.9)` | Profile dropdown, high-contrast menus |
| `bg-white/95` | `rgba(255,255,255,0.95)` | Primary CTA button (light on dark) |
| `bg-white/10` | `rgba(255,255,255,0.1)` | Hover fill on dark glass surfaces |
| `bg-black/30 backdrop-blur-md` | — | FocusOverlay backdrop |

### Semantic colors

| Token | Use |
|-------|-----|
| `text-red-200` | Error message text |
| `border-red-400/40` | Error banner border |
| `text-gray-900` | Text on light (white) buttons |

### CSS custom properties (shadcn tokens)
Defined in `globals.css`. Prefer Tailwind utilities over direct CSS var references in component code. Key values:

| Variable | Approx value |
|----------|-------------|
| `--background` | Near-black `#1a1a20` |
| `--foreground` | Near-white `#fafafa` |
| `--primary` | Muted grey `oklch(0.71 0.013 286)` |
| `--border` | Dark grey `oklch(0.27 0.006 286)` |
| `--radius` | `0.5rem` (8px) |

---

## Surfaces & Glassmorphism

Every floating UI surface is built from the same three-part recipe:

```
bg-black/{opacity}   +   backdrop-blur-{size}   +   border border-white/20
```

| Surface type | Recipe | Example |
|---|---|---|
| Primary glass (search bar, Get Started) | `bg-black/30 backdrop-blur-2xl border-white/20` | Search bar container |
| Panel / card | `bg-black/70 backdrop-blur-md border-white/20` | Overlay panels, input forms |
| Dense / menu | `bg-black/90 backdrop-blur-sm border-white/15` | Profile dropdown |
| Overlay backdrop | `bg-black/30 backdrop-blur-md` | FocusOverlay background |

Always pair a surface with `rounded-{size}` and `shadow-2xl`. Never use a hard opaque background on new pages.

### Border radius scale

| Token | px | Use |
|-------|----|-----|
| `rounded-lg` | 8px | Inputs, dropdown rows, small cards |
| `rounded-xl` | 12px | Individual interactive fields, buttons, auth card |
| `rounded-2xl` | 16px | Large containers (search bar, primary panels) |
| `rounded-full` | 9999px | Avatars, pill badges |

---

## Layout

### Page scaffold

All pages use **full-viewport fixed layers**, not a scrolling document layout:

```
fixed inset-0          → background (z-0)
fixed inset-0 z-10     → hero / main content
fixed top-0 left-0 z-20  → logo
fixed top-0 right-0 z-20 → auth / profile
fixed bottom-* z-50    → primary action bar (search bar, etc.)
z-100                  → overlays (FocusOverlay portals)
```

### Consistent padding (top corners)

```
p-4 sm:p-6 md:p-8
```

Used on both the logo block and the auth block. Always match these so top-corner elements align at every breakpoint.

### Horizontal centering + max-width

| Pattern | Use |
|---|---|
| `left-1/2 -translate-x-1/2 w-[calc(100vw-2rem)] max-w-4xl` | Full-width bar capped at 896px (search bar) |
| `max-w-3xl px-6 sm:px-8` | Overlay panel content area |
| `max-w-sm mx-auto` | Narrow card (auth form) |
| `max-w-lg mx-auto` | Medium panel (SearchBar, GuestSelector, DatePicker) |

### Vertical positioning

- Hero copy: `translate-y-[12vh]` from true center (slightly below) — keeps it clear of the logo on tall viewports
- Search bar: `bottom-16 sm:bottom-20` — breathing room above the browser chrome on mobile

---

## Interactive States

Apply these consistently on every interactive element.

| State | Classes |
|-------|---------|
| Hover (dark surface) | `hover:bg-white/10 transition-colors` |
| Hover (light CTA button) | `hover:bg-white hover:shadow-xl hover:scale-[1.02]` |
| Active / press (CTA button) | `active:scale-[0.98]` |
| Disabled | `opacity-50 pointer-events-none` |
| Transition default | `transition-colors` (150ms ease-in-out via Tailwind default) |
| Transition with transform | `transition-all` |

The **primary CTA button** pattern (light on dark):
```tsx
className="px-6 py-3 bg-white/95 text-gray-900 rounded-xl font-semibold
           hover:bg-white transition-all shadow-lg hover:shadow-xl
           hover:scale-[1.02] active:scale-[0.98] text-sm"
```

The **ghost / glass button** pattern (dark surfaces):
```tsx
className="border border-white/20 text-white/90 rounded-lg px-3 py-2
           text-sm font-medium hover:bg-white/10 transition-colors"
```

---

## Overlay Pattern (`FocusOverlay`)

All panels (search, date picker, guests, auth) use the same portal-based overlay. Never build a custom modal — extend this component.

**Behaviour:**
- Rendered via `createPortal` into `document.body`
- Locks body scroll on open
- Closes on: backdrop click, `Escape` key
- Inner content: `max-w-3xl px-6 sm:px-8`, centred

**Usage:**
```tsx
<FocusOverlay open={isOpen} onClose={() => setIsOpen(false)}>
  {/* panel content */}
</FocusOverlay>
```

When the inner panel has its own click/mousedown handlers (e.g. a calendar), wrap it in a div with `stopPropagation` to prevent the backdrop from closing it accidentally.

**Overlay panel anatomy:**
```
CardTitle — uppercase tracking label at text-white/60
Card / form — bg-black/70 backdrop-blur-md border-white/20 rounded-lg
```

---

## Icons

All icons live in `components/Icons.tsx`. They are inline SVGs with:
- `className="w-4 h-4 sm:w-5 sm:h-5 shrink-0"`
- `fill="none" stroke="white" strokeWidth={2}`
- `viewBox="0 0 24 24"`

For icons from `lucide-react` (used in GuestSelector): apply `className="h-4 w-4"`.

Do not import icons from multiple sources on the same component. For new icons, add them to `components/Icons.tsx` following the existing pattern.

---

## Image & Media

### Logo
```
src: https://cdn.openbookings.co/Openbookings-logo-v2.png
size: h-8 sm:h-10 md:h-16 w-auto
attrs: draggable="false", pointer-events-none, user-select-none
```

### Background images
- Served from `https://images.openbookings.co/{image_path}`
- Registered in `lib/backgrounds.json`
- Always set `bg-cover bg-center bg-no-repeat` on the container
- Always add the directional gradient overlay on top:
  ```
  linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0) 100%)
  ```
- Show `bg-black` as the loading state (no skeleton, no spinner)

### User avatar
```
src: /profile_avatar.png  (local public asset)
size: h-12 w-12 rounded-full object-cover
border: border border-white/20 shadow
```

---

## Accessibility Baseline

Follow these on every page:

- **Interactive divs are a bug.** Every clickable element must be a `<button type="button">` or `<a>`. `div` + `onClick` is not keyboard accessible.
- **Menus** need `role="menu"` on the container and `role="menuitem"` on each item. The trigger button needs `aria-haspopup="menu"` and `aria-expanded`.
- **Alerts** (error banners, toasts) must have `role="alert"` so screen readers announce them on mount.
- **Icon-only buttons** need `aria-label`.
- **Stepper buttons** (`+` / `−`) need descriptive `aria-label` e.g. `"Increase adults"`.
- **Focus trap**: FocusOverlay does not trap focus today. When building any overlay that contains a form, add a focus trap (e.g. `focus-trap-react`) so keyboard users cannot tab behind it.
- **Non-interactive text** that should not be selectable: use `select-none` (already applied to logo, hero copy, avatar).

---

## Analytics (PostHog)

Capture a PostHog event for every meaningful user interaction. Event names use `snake_case`.

```ts
posthog.capture("event_name", { optional_property: value });
```

Always import from `"posthog-js"` on client components. Server-side use `lib/posthog-server.ts`.

Standard events already in use: `auth_form_opened`, `auth_error`, `sign_out`, `destination_search_opened`, `destination_selected`, `date_picker_opened`, `guest_selector_opened`, `search_initiated`.

---

## Do / Don't

| Do | Don't |
|----|-------|
| Use the glass surface recipe | Invent new opaque dark backgrounds |
| Use `rounded-xl` or `rounded-2xl` on containers | Mix in sharp corners or very large radii |
| Use `border-white/20` as the default border | Use visible coloured borders except for errors |
| Use `transition-colors` on hover fills | Animate layout properties (width, height) |
| Add new icons to `components/Icons.tsx` | Scatter inline SVGs across components |
| Use `FocusOverlay` for any modal/panel | Build custom modal wrappers |
| Use `<button type="button">` for all actions | Use `<div onClick>` |
| Match `p-4 sm:p-6 md:p-8` for top-corner fixed elements | Pick arbitrary padding per page |
