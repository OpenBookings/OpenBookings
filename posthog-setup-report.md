<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into OpenBookings. Here is a summary of what was changed:

- **`instrumentation-client.ts`** (new) — Initializes `posthog-js` on the client side using Next.js 15.3+ instrumentation. Configured with the EU PostHog host via the `/ingest` reverse proxy, with exception capturing enabled.
- **`lib/posthog-server.ts`** (new) — Helper that creates a per-request `posthog-node` client for server-side event capture in API routes.
- **`next.config.ts`** — Added `/ingest/*` and `/ingest/static/*` reverse proxy rewrites pointing to `eu.i.posthog.com` and `eu-assets.i.posthog.com`. Added `skipTrailingSlashRedirect: true`. Updated CSP `connect-src` to allow PostHog EU hosts.
- **`.env.local`** — Added `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and updated `NEXT_PUBLIC_POSTHOG_HOST`.
- **`components/auth/CS-AuthForm.tsx`** — Captures `auth_form_opened` when the sign-in overlay is opened.
- **`components/auth/AuthFormFields.tsx`** — Captures `magic_link_requested`, `sign_in_google_clicked`, `sign_in_apple_clicked`. Identifies users and captures `sign_in_completed` / `sign_in_failed` on Google and Apple OAuth flows.
- **`components/auth/VerifyEmailForm.tsx`** — Identifies users and captures `sign_in_completed` after magic link verification. Captures `sign_in_failed` with error code and sends exception to PostHog error tracking.
- **`app/page.tsx`** — Captures `search_initiated` with destination and date/guest params when "Find my trip" is clicked. Captures `sign_out` and calls `posthog.reset()` when user signs out.
- **`components/plug-in/SearchBar.tsx`** — Captures `destination_selected` with city and country when a user picks an Algolia autocomplete result.
- **`app/api/query/route.ts`** — Server-side: captures `hotel_search_completed` (with result count and search params) or `hotel_search_failed` (with error message) after each hotel search query.
- **`app/auth/login-link/route.ts`** — Server-side: captures `magic_link_sent` after a magic link email is successfully dispatched.

## Events

| Event | Description | File |
|---|---|---|
| `auth_form_opened` | User opens the sign-in / get-started overlay | `components/auth/CS-AuthForm.tsx` |
| `magic_link_requested` | User submits their email to receive a magic sign-in link | `components/auth/AuthFormFields.tsx` |
| `sign_in_google_clicked` | User initiates Google OAuth sign-in | `components/auth/AuthFormFields.tsx` |
| `sign_in_apple_clicked` | User initiates Apple OAuth sign-in | `components/auth/AuthFormFields.tsx` |
| `sign_in_completed` | User successfully authenticates (magic link, Google or Apple) | `components/auth/VerifyEmailForm.tsx`, `components/auth/AuthFormFields.tsx` |
| `sign_in_failed` | Authentication attempt failed, includes error code | `components/auth/VerifyEmailForm.tsx`, `components/auth/AuthFormFields.tsx` |
| `sign_out` | Authenticated user signs out | `app/page.tsx` |
| `destination_selected` | User selects a destination from Algolia autocomplete results | `components/plug-in/SearchBar.tsx` |
| `search_initiated` | User clicks 'Find my trip' to start a hotel search | `app/page.tsx` |
| `hotel_search_completed` | Hotel search API query returned results; includes result count and search params | `app/api/query/route.ts` |
| `hotel_search_failed` | Hotel search API query failed with a database error | `app/api/query/route.ts` |
| `magic_link_sent` | Server successfully generated and sent a magic link email | `app/auth/login-link/route.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://eu.posthog.com/project/117466/dashboard/579224
- **Sign-in funnel** (auth_form_opened → magic_link_requested → sign_in_completed): https://eu.posthog.com/project/117466/insights/CiClrqkC
- **Search funnel** (search_initiated → hotel_search_completed): https://eu.posthog.com/project/117466/insights/kzTszocu
- **Daily sign-ins vs sign-outs** (churn signal): https://eu.posthog.com/project/117466/insights/Kn6qeBKQ
- **Search engagement trend** (destination_selected + search_initiated over time): https://eu.posthog.com/project/117466/insights/GqtyoHnX
- **Sign-in method breakdown** (Google vs Apple vs magic link): https://eu.posthog.com/project/117466/insights/e0YVUmrk

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
