# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev      # Start Next.js dev server
bun run build    # Production build (Next.js standalone output)
bun run start    # Start production server on PORT (default 8080)
bun run lint     # Run ESLint
```

No test suite is configured. The project uses Bun as the package manager (see `bun.lock`).

## Architecture

This is a **Next.js 16 (App Router)** hotel booking platform using React 19 and TypeScript. It deploys as a Docker container to **Google Cloud Run** via Cloud Build (`cloudbuild.yaml`).

### App Structure

- `app/` — Next.js App Router pages and API routes
  - `page.tsx` — Home page: fullscreen hero with destination/date/guest search box
  - `auth/` — Email magic-link auth flow (login-link, verify, bootstrap-user)
  - `api/query/` — `GET /api/query` hotel search endpoint + pricing calculator
  - `search/` — Demo search UI for exercising the query API
  - `map/` — Map view page
  - `demo/` — Demo page
- `components/` — Reusable React components
  - `auth/` — Auth form components
  - `plug-in/` — UI plug-ins: SearchBar, DatePicker, GuestSelector, FocusOverlay
  - `search/` — HotelCard, SearchSummaryBar, SkeletonGrid
  - `ui/` — shadcn/ui primitives
- `lib/` — Server/shared utilities
  - `firebase/` — Firebase client (`firebase.client.ts`), server-side admin (`firebaseAdmin.ts`)
  - `postgres/db.ts` — PostgreSQL pool + query helpers
  - `algolia.ts` — Algolia search client (index: `Cities`)
  - `mailing/` — Postmark email sending
  - `posthog-server.ts` — Server-side PostHog client
  - `rateLimit.ts` — In-memory rate limiting
- `types/hotel.ts` — Shared TypeScript types (`HotelSearchInput`, `HotelSearchResult`)

### Key Integrations

| Service | Purpose | Config |
|---|---|---|
| Firebase Auth | Email magic-link authentication | `NEXT_PUBLIC_FIREBASE_*` env vars |
| PostgreSQL | Hotel/room data | `NEXT_PUBLIC_DATABASE_URL` |
| Algolia | City/destination search (index: `Cities`) | Hardcoded public keys in `lib/algolia.ts` |
| MapLibre + MapTiler | Interactive map | `NEXT_PUBLIC_MAPTILER_*` env vars |
| PostHog (EU) | Analytics, proxied via `/ingest/*` | `NEXT_PUBLIC_POSTHOG_KEY/HOST` |
| Postmark | Transactional email (magic links) | `NEXT_PUBLIC_POSTMARK_SERVER_TOKEN` |
| CookieYes | Cookie consent | Hardcoded script in `app/layout.tsx` |

### Authentication Flow

Magic-link email auth only — no password auth:
1. User submits email → `POST /auth/login-link` generates Firebase magic link via `firebaseAdmin.ts`, sends via Postmark
2. User clicks link → redirected to `/auth/verify` → Firebase verifies token
3. `/auth/bootstrap-user` sets up user profile on first login
4. Home page (`page.tsx`) handles Firebase auth callback params (`oobCode`, `mode`) and redirects appropriately

### Search Flow

1. Destination typeahead uses Algolia (`react-instantsearch`) on the `Cities` index
2. Search submits lat/lon + dates/guests to `GET /api/query`
3. API queries PostgreSQL for available rooms near coordinates, runs pricing through `calculator.ts`

### Deployment

- Next.js builds as **standalone** output
- Deployed to Google Cloud Run as Docker container (port 8080)
- All env vars are passed as Docker `--build-arg` at Cloud Build time
- CSP headers are configured in `next.config.ts` — update there when adding new external domains
- Firebase Auth proxy rewrite (`/__/auth/*`) is optional, enabled via `NEXT_PUBLIC_FIREBASE_AUTH_PROXY=true`
