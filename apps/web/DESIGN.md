# Design System — OpenBookings Web

**Superseded by [`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md) at the repo root.**

The design language is now defined once for the whole monorepo. This file is kept as a stub so the
git history of the original web design system stays reachable (`git log --follow apps/web/DESIGN.md`).

## Where the content went

| Was here | Now |
|---|---|
| Typography, Colour & Opacity, Radius scale | `DESIGN_SYSTEM.md` §2 (Layer 1 — shared brand foundation) |
| Surfaces & Glassmorphism, Layout scaffold, Interactive States, `FocusOverlay`, Image & Media | `DESIGN_SYSTEM.md` §3.2 (Glass mode) |
| Icons | `DESIGN_SYSTEM.md` §2.7 — `lucide-react` is the foundation set; `components/Icons.tsx` remains a documented Glass carve-out |
| Accessibility Baseline, PostHog conventions | `DESIGN_SYSTEM.md` §3.4 — these apply in **both** modes, not just web |
| Do / Don't | Folded into §3.2 and §3.4 |

## App-specific section

`apps/web` contains **both** surface modes. See `DESIGN_SYSTEM.md` §3.1 for the mapping:

- **Glass** — `app/p/[hotel_slug]`, `app/search`, `app/(root)`, `components/plug-in`,
  `components/search`, `components/auth`, `components/nav.tsx`. The glass surface recipe,
  white-alpha palette, fixed-layer scaffold, and `FocusOverlay` all live here. See §3.2.
- **Console** — `app/checkout`, `components/ui`. Semantic tokens only, no decorative blur. See §3.3.

## Open items specific to this app

- `FocusOverlay` does not trap focus. Any overlay containing a form needs one added.
- `Libre Franklin` is declared in `globals.css` but **not loaded** in `app/layout.tsx` —
  see `DESIGN_SYSTEM.md` §5, bug fix #1.
