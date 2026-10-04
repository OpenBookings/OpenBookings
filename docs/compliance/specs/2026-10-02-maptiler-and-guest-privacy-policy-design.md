# MapTiler default and guest privacy policy — design

**Date:** 2 October 2026
**Closes:** audit D7 (sub-processor inventory, guest side), drift #2 ("Google Cloud" hosting)
**Status:** approved and implemented (branch `compliance/maptiler-privacy-policy`)

Two small changes that share one reason: the map vendor has to be settled
before the policy can list it.

## Part 1 — CartoDB → MapTiler

Carto is only the default style in the shared map component; every real map
already passes a MapTiler style.

- `apps/web/components/ui/map.tsx:63-64` and
  `apps/business/components/ui/map.tsx:48-49`: replace the Carto default
  styles with the MapTiler style built from `NEXT_PUBLIC_MAPTILER_STYLE_ID`
  and `NEXT_PUBLIC_MAPTILER_API_KEY`. Update the "Overrides the default Carto
  styles" doc comments.
- If either env var is missing, the map renders a visible "Map unavailable"
  placeholder. It does not fall back to another tile vendor.
- Callers that build the same MapTiler URL themselves (`LocationSection.tsx`,
  `GeneralMap.tsx`, `location.tsx`, `core-info-location.tsx`) drop their copy
  and rely on the default.
- `apps/business/next.config.ts:23`: remove `https://basemaps.cartocdn.com`
  from `connect-src`.

Check: load the listing page map, the business location section and the
onboarding address step; confirm no request to `cartocdn.com` in the network
log.

## Part 2 — Guest privacy policy

### Scope

This policy covers the guest site (`apps/web`): private customers browsing and
booking. Hosts and the business portal get their own policy later; nothing
about host data, Microsoft sign-in or host fraud signals belongs here. The
policy says so in its first section and points hosts to the Partner Agreement
until the business policy exists.

### Mechanics

- New version directory `apps/web/content/legal/privacy/2026-10-02/` with
  `en.mdx`, `nl.mdx`, `fr.mdx`.
- Register it in `apps/web/lib/legal/documents.ts` and set
  `currentVersion: "2026-10-02"`. The `2026-09-21` version stays registered
  and readable at its archive URL.
- `en` is `translated`; `nl` and `fr` stay `draft` until reviewed, as today.
- Bump `NEXT_PUBLIC_COOKIE_VERSION` only if the cookie section's substance
  changes. Listing the consent record (see below) is a disclosure, not a new
  purpose, so no re-consent is forced.

### Vendor table rule

List a vendor only if it actually receives guest personal data from `apps/web`
today. A vendor that is configured but not wired, or that only serves the
business portal, is not listed.

| Vendor | What they get | What for | Where |
|---|---|---|---|
| Neon | Account and booking records | Database hosting | EU (Frankfurt) |
| Scaleway | Data processed by the app while it runs | Application hosting | EU (Amsterdam) |
| Algolia | Search queries, IP address | Destination search | EU |
| MapTiler | IP address, map area viewed | Map tiles | EU (France and Ireland) |
| Lettermint | Email address, booking details | Transactional email | EU |
| PostHog | Usage events, session recordings, account ID (no name or email) | Product analytics, with consent | EU |
| Sentry | Error reports, stack traces, browser type, page-load timing | Error and performance tracking | EU (Germany) |
| Cloudflare | IP address, request metadata | CDN, DDoS and bot protection | EU / US (SCCs) |
| Stripe | Name, email, booking amount | Payment processing | EU / US (SCCs) |

Sign-in providers (Google, Apple) are listed in a separate short table as
independent controllers the guest chooses to use, not as processors.

**Removed or not listed, with the reason:**

- Google Cloud as application hosting — wrong; hosting is Scaleway.
- Tirreno — not active or wired.
- Chatwoot — self-hosted, so not a third-party processor in itself.
- CartoDB — removed in Part 1.
- Dicebear, Microsoft OAuth — business portal only.
- Upstash — on the guest site it caches property pages only, no guest data
  (found in review).
- Cloudflare message relay and rate limiting — not live on the guest site;
  they are added in the policy version that ships them.

Callers get the MapTiler default from the shared `@openbookings/maps` package
rather than a per-app helper (changed in review to stop the two apps drifting).

### Other content fixes in the same version

- Security section: "Infrastructure is on Google Cloud" → Scaleway.
- Cookie table: `ob_cookie_consent` row mentions that the choice is also
  recorded on our servers without an IP address (consent log spec).
- Retention table: add "Consent records — 5 years".

## Open items for Wouter

1. **Guest support chat — resolved: not listed.** Wouter's rule is to include
   the support vendors only if chat is actually live. Neither `apps/web` nor
   `apps/business` embeds a Chatwoot widget, so guests cannot reach the bot
   from the site and Mistral stays out. Scaleway is listed regardless, as the
   application host. When chat ships, that policy version adds Mistral and
   whatever hosts the bot and the Chatwoot server; the bot code currently
   targets Google Cloud Tasks and Cloud Run (`apps/support-bot/src/tasks.ts`),
   so confirm where it really runs at that point.
2. **Regions.** MapTiler (France and Ireland) and Sentry (Germany) confirmed
   by Wouter. Upstash is not listed (see above), so its London region does
   not appear in the policy.
   The Stripe row's purpose changes to "payment processing on behalf of the
   property" once direct charges ship; until then it stays as written.
3. **Cloudflare R2.** The audit found no bucket in the Cloudflare account
   (D8b). Where property images live does not affect guest personal data, so
   it does not block this policy.
4. **Legal review.** The `nl` and `fr` texts are my translations and stay
   marked draft; the English text should be read by whoever signs off legal
   copy before it replaces the current version.
