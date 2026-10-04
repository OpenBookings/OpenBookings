# OpenBookings — Codebase Compliance Audit

**Date:** 28 September 2026
**Scope:** `apps/web`, `apps/business`, `apps/support-bot`, `apps/docs`, `packages/*`, `.github/*`, plus the deployed `ob-durableobjects` Cloudflare Worker.
**Method:** Static read-only audit. Code is the source of truth; Notion statements were treated as hypotheses. No application code, migration, database or remote system was modified.
**Evidence rule:** every finding cites `path:line`. No secret or env *values* appear in this document — variable names only.

---

> **Update (28 Sep 2026, post-audit):** the guest privacy policy has since been
> extracted from `apps/web/app/privacy/page.tsx` into versioned MDX at
> `apps/web/content/legal/privacy/<version>/<locale>.mdx`, served from
> `/legal/[locale]/[doc]` with `/privacy` permanently redirecting. The extraction
> preserved the wording **verbatim**, so every content finding below (notably the
> "Google Cloud" hosting claim and the incomplete sub-processor table) is
> unchanged and still outstanding. Documents are now addressable as
> `privacy@2026-09-21/nl`, which is the identifier §D3's `consent_log` fix should
> record.

> **Update (2 Oct 2026):** two findings below are resolved on branch
> `compliance/maptiler-privacy-policy`. **CartoDB is no longer used**: both apps
> default to MapTiler via `@openbookings/maps`, and Carto is gone from the
> business CSP, so its row in §4 is historical. **The guest privacy policy has a
> new version, `privacy@2026-10-02`**, which names Scaleway as host, lists
> MapTiler, and lists only vendors that receive guest personal data from
> `apps/web` (issue #5 in §1, D7 and drift #2, guest side). The host-side
> policy is still outstanding. Specs and plans for this and the other fixes are
> in `docs/compliance/specs/` and `docs/compliance/plans/`.

## 1. Summary

**Verdict counts:** 28 ISSUE · 12 OK · 7 DRIFT · 5 UNKNOWN.

The single most important framing point, which changes how nearly every payments and tax finding should be read: **the guest checkout path is prototype scaffolding, not a live transaction flow.** `apps/web/app/checkout/_lib/booking.ts:21` pins every checkout to one hardcoded seeded booking UUID, no application code creates a booking row, and `application_fee_amount` is commented out. Most section A and E gaps are therefore *"not built yet"*, not *"built wrong"*, and should be treated as pre-launch scope rather than regressions.

The genuine exposure is different and sharper: **published, shipped artefacts already make specific promises the code does not keep.** The host documentation states funds are held by the platform, the marketing site and signed Partner Agreement promise 4.5% commission, the analytics dashboard shows hosts a 4.5% deduction Stripe never takes, the listing page prints "Incl. Tax & Fees" over a price that excludes tax, and the privacy policy names a hosting provider that is not used. Those are live today and independent of build status.

**Top 5 issues by severity**

| # | Issue | Why it ranks here |
|---|---|---|
| 1 | **Passkey step-up is not enforced on payout changes** (`apps/business/app/api/stripe/account-link/route.ts:7-17`) | A stolen host session cookie alone can mint a Stripe Account Link and redirect a property's payouts. Direct financial loss. The security UI already promises this protection (`security-panel.tsx:196`) and the code comment says these endpoints "call `isStepUpFresh` themselves when they are built" (`packages/auth/src/shared.ts:460`) — they were built, and they do not. |
| 2 | **False all-in price claim on listing pages** (`apps/web/app/p/[hotel_slug]/_components/RoomsCarousel.tsx:419`) | "Incl. Tax & Fees" is printed directly under a raw `rate.bar` figure; tourist tax is first added at checkout (`booking.ts:279-285`). Shipped, guest-facing, and a misleading omission under the Price Indication Directive and UCPD. |
| 3 | **No AI disclosure in the support bot** (`apps/support-bot/src/agent/prompt.ts:5-14`) | AI Act Art. 50 has been in force since 2 Aug 2026. The system prompt contains no disclosure instruction at all — not even the weak "model is asked to say it" form. |
| 4 | **Cookie consent cannot be proven, and there is no DSR cascade** (`packages/analytics/src/client.tsx:55-58`; no account-deletion or export route exists) | Consent lives only in the visitor's own `localStorage`; no `consent_log` table exists. Erasure is a manual email process with one hand-run PostHog script. Fails GDPR accountability (Art. 5(2), 7(1), 12, 17, 20). |
| 5 | **Privacy policy is materially inaccurate** (`apps/web/content/legal/privacy/2026-09-21/en.mdx:286,315`) | Names "Google Cloud" as application hosting (actual: Scaleway) and omits Chatwoot, Mistral, Tirreno, MapTiler, CartoDB, Microsoft OAuth and Apple Sign-In. This is the Art. 13/14 disclosure to data subjects, so it is a compliance defect, not doc drift. |

Honourable mention: the **3.5% / 4.5% commission split** (§E4) is documented by the product's own docs as a known discrepancy while the signed Partner Agreement promises 4.5% with 30 days' notice.

---

## 2. Findings

Severity is my own grading, applied consistently across sections; where it differs from the section agent's, the reasoning is stated.

### A · Payments & PSD2

| ID | Check | Verdict | Sev | Evidence | Proposed fix | Effort |
|---|---|---|---|---|---|---|
| A1 | Payout schedule | ISSUE | High | `packages/stripe/src/connect/accounts.ts:15-38` — sole `accounts.create`, no `settings.payouts.schedule`; no `accounts.update` anywhere | Set `settings.payouts.schedule` explicitly (`interval`, `delay_days`) to match the 7-day figure published to hosts | S |
| A2 | Discretionary release | **OK** | — | No `payouts.create` / `transfers.create` repo-wide; `apps/business/app/api/cron/*` touch only retention; no `schedule:` trigger in any workflow | — | — |
| A3a/b | `transfer_data` / `on_behalf_of` | **OK** | — | `apps/web/app/api/checkout/route.ts:257-259` destination set at creation; `on_behalf_of` absent with justifying comment `:260-265` | — | — |
| A3c | `statement_descriptor_suffix` | ISSUE | Med | Zero hits repo-wide | Set suffix from property name (≤22 char combined limit) | S |
| A3d | `application_fee_amount` | ISSUE | High | `route.ts:266-267` commented out; `apps/web/app/checkout/_lib/booking.ts:320` `platformFeeCents: 0`; `packages/db/src/schema.ts:89` `commission_rate` **never read by any code** | Wire fee from one authoritative rate source, computed on the pre-tax room base | M |
| A4 | Refunds | UNKNOWN | High | No refund-creation code exists; only read-only `stripe.refunds.list` (`packages/stripe/src/payments/status.ts:44`) | Settle where refunds are issued today, then build Path B with step-up + audit log | M |
| A5 | Disputes | ISSUE | High | `apps/business/app/api/stripe/webhook/route.ts:20-32` handles only `account.updated`; no `charge.dispute.*`; `debit_negative_balances` never set. Note `losses:{payments:'application'}` (`accounts.ts:19`) *is* set, matching the "platform absorbs disputes" promise | Add dispute handlers; set `debit_negative_balances` explicitly | M |
| A6 | Payment method config | **OK** | — | `route.ts:140-155` `resolvePaymentMethodConfiguration`, platform preset, comment explains dormant connected preset | — | — |
| A7 | Webhook security | ISSUE | Med | Signature + raw body correct (`webhook/route.ts:8-18`); but `processed_events` (`schema.ts:617-620`) is used **only** by the Chatwoot bot, not Stripe. `checkout.session.completed` unhandled entirely | Key the Stripe handler on `event.id` against `processed_events`; add missing event handlers | S–M |
| A8 | **Hardcoded `country: 'NL'`** *(new — not in brief)* | ISSUE | High | `packages/stripe/src/connect/accounts.ts:25,33` hardcode `'NL'` although `actions.ts:185` passes the host's real country; `:27` hardcodes `business_type:'company'` | Use `hostData.country`; support individual sellers (also a DAC7 blocker, §E1) | S |

### B · Consumer law & price display

| ID | Check | Verdict | Sev | Evidence | Proposed fix | Effort |
|---|---|---|---|---|---|---|
| B1 | All-in price | ISSUE | High | `RoomsCarousel.tsx:416,419` renders raw `rate.bar` with "Incl. Tax & Fees" beneath it; tourist tax first appears at `booking.ts:279-285`; calculator has no VAT/tax/fee field (`packages/pricing/src/calculator.ts:452-460,576-592`) | Thread `tax_rate` through the calculator so `total_price` is genuinely all-in; render `total_price` not `bar`; remove the label until true | M |
| B2 | Tourist tax | ISSUE | Med | Modelled per-property (`schema.ts:90`) but invisible to guests until checkout; no "payable at property" copy anywhere in `apps/web` | Surface "+ city tax" pre-commitment; label the checkout line correctly | S–M |
| B3 | Pre-contract info | ISSUE | High | No CRD 16(l) notice anywhere; `TripSummary.tsx:341-352` Terms and Cancellation policy both `href="#"` (comment `:340` "placeholders by design"); **no `/terms` route exists**; disclosed-agent sentence exists only on the listing page (`PoliciesSection.tsx:184-190`), never in checkout | Author Terms + Cancellation pages and link them; add 16(l) notice and the disclosed-agent sentence above the pay button | S (copy) / M (pages) |
| B4 | Marketplace transparency | Mixed | Med | Trader label **OK** (`PoliciesSection.tsx:184-190`, `BusinessDetailsButton.tsx:36-40`). No ranking explainer; "Top" sort is silently price-ascending (`calculator.ts:591`). **No reviews table exists**, yet `HotelCard.tsx:206-219` renders a star badge reading "0 out of 10, 0 reviews" | Disclose the ranking basis near the sort control; gate the rating badge on `reviews > 0` | S |
| B5 | Pressure patterns | **OK** | — | No scarcity/urgency copy found. The only countdown is the checkout hold timer driven by the real Stripe session `expires_at` (`checkout/route.ts:157-165`) — real state, not decorative | — | — |
| B6 | **No i18n catalogue** *(new)* | ISSUE | Low | All guest copy is hardcoded English JSX despite an NL/BE target market | Consider NL/FR copy for consumer-facing legal notices | M |

### C · AI Act Art. 50

| ID | Check | Verdict | Sev | Evidence | Proposed fix | Effort |
|---|---|---|---|---|---|---|
| C1a | AI disclosure | ISSUE | High | `apps/support-bot/src/agent/prompt.ts:5-14` — `SYSTEM_PROMPT` contains no disclosure language; no "AI"/"bot"/"automated" strings anywhere in the bot source | Add a deterministic first-message disclosure (not prompt-only) | S (prompt) / S–M (durable) |
| C1b | UI-level disclosure | UNKNOWN | High | No Chatwoot widget embed in this repo; greeting is configured in the Chatwoot admin UI | Check the live inbox greeting; if absent, add it there | S |
| C1c | Host-side bot | N/A | — | `apps/business/app/(dashboard)/support/page.tsx:1-17` renders `<ComingSoon />` — no host bot exists yet | Pre-launch blocker for whenever host support ships | — |
| C1d | Human handoff | **OK** | Low | `tools.ts:228-233` `escalate_to_human`; deterministic pre-model dispute regex `escalation.ts:71-80`; iteration-cap fallback `loop.ts:84-87` | Optional: add a deterministic "talk to a human" intent net | S |
| C2 | Data to Mistral | **OK** | Low | `loop.ts:63-66` sends only system prompt + chat turns; `guestEmail` used server-side for authorization only (`process.ts:70`, `tools.ts:55-65`), never placed in the prompt; tool results carry no email/name/address (`tools.ts:105-131`); **no RAG/pgvector exists**; no LLM data sent to PostHog or Sentry | Confirm Mistral DPA retention/training terms (contract, not code) | S |

### D · Privacy / GDPR / ePrivacy

| ID | Check | Verdict | Sev | Evidence | Proposed fix | Effort |
|---|---|---|---|---|---|---|
| D1a | PostHog consent gating | **OK** | — | `packages/analytics/src/client.tsx:139` init runs only when `consent === 'accepted'`; default `null` = opt-in | — | — |
| D1b | `autocapture` | **OK** | — | `client.tsx:148` `autocapture: false` | — | — |
| D1c | Replay masking | **OK** | — | `client.tsx:152-155` `maskAllInputs: true`, `maskTextSelector: '*'` | — | — |
| D1d | Console log capture | ISSUE | Med | No local override exists. **Verified in the installed SDK (posthog-js 1.422.5)**: the option is `config.logs.captureConsoleLogs`, and `onRemoteConfig` enables capture from the *remote project setting* when the local config is silent. Project setting is ON | Set `logs: { captureConsoleLogs: false }` in `posthog.init`. *(Note: a `session_recording.captureConsole` key does not exist in this version)* | S |
| D1e | Replay enablement | ISSUE | Low | `disable_session_recording` never set, so replay follows the project toggle | Set explicitly for auditability | S |
| D2a | Sentry `sendDefaultPii` | **OK** | — | Not set anywhere; SDK default `false` | Set explicitly | S |
| D2b | Sentry `beforeSend` | ISSUE | Med | Zero `beforeSend` hooks repo-wide — no scrubbing of `event.extra`/`contexts` | Add a scrubbing `beforeSend` in each config | M |
| D2c | Sentry replay | **OK** | — | No `replayIntegration` anywhere — Sentry replay is simply not enabled | — | — |
| D2d | Sentry region | UNKNOWN | Med | Env var names only (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`); region is encoded in the DSN value, not in the repo | Confirm the DSN host is EU | S |
| D2e | `tracesSampleRate: 1` | Note | Low | 100% in all four configs | Data-minimisation / cost consideration | S |
| D3 | Consent evidence | ISSUE | High | `client.tsx:55-58` writes to `localStorage` only; no server call, no cookie, no DB row; **no `consent_log` table** in `schema.ts`. `org_consent` (`0011_org_iam.sql:44-54`) is host legal-document signing only. EU detection is a spoofable timezone heuristic (`CookieBanner.tsx:11-14`) | Add `/api/consent` + `consent_log` table recording decision, version, timestamp, IP, UA | M |
| D4a | Retention jobs exist | **OK** | — | `messaging-retention` anonymises `messages` >365d (`packages/messaging/src/routes.ts:293-312`); `pii-retention` nulls `guest_notes`/`cancellation_reason` >18mo while correctly preserving financials for the 7-year fiscal duty | — | — |
| D4b | **Retention jobs are never triggered** | ISSUE | High | Route comments describe GCP Cloud Scheduler (`messaging-retention/route.ts:6-15`, `pii-retention/route.ts:12-18`) but deployment is Scaleway (`ci.yml:19-20`). **No `schedule:` trigger in any workflow and no Scaleway cron config in-repo** | Create a real scheduled trigger; update the stale comments | S |
| D4c | `audit_log` IP retention | ISSUE | Med | `0011_org_iam.sql:67-78` append-only, stores `ip` (`:74`) and `user_agent` (`:75`), written on every sign-in (`packages/auth/src/host.ts:135-143`). No purge exists | Drop `ip`/`user_agent` after N months | S |
| D4d | Support caches never purged | ISSUE | Med | `support_context_cache` holds guest conversation turns; indexes on `processed_at`/`updated_at` suggest an intended sweep, but no `DELETE` exists anywhere | Add purge to the retention job | S |
| D4e | `pii-retention` non-constant-time auth | ISSUE | Low | `pii-retention/route.ts:25` uses plain `!==`; sibling route uses `timingSafeEqual` (`routes.ts:52-58`) | Reuse `bearerAuthorized` | S |
| D5 | Data subject rights | ISSUE | High | No account-deletion or export route exists for guests or hosts. Only `scripts/delete-posthog-person.ts` — a manual CLI. No deletion propagation to Chatwoot or Tirreno. Privacy page promises the full Art. 15-21 set via email (`page.tsx:335-352`) | Build one "erase user" routine fanning out to DB anonymisation, PostHog, Chatwoot, Tirreno, writing completion to `audit_log` | M |
| D6 | Automated decisions (Art. 22) | **OK** | — | `packages/messaging/src/circumvention.ts:1-6` explicit "warn-and-log, not block"; message always inserted (`routes.ts:173-191`); `flagged_reason` only rendered as a UI badge. Tirreno is **write-only** (`apps/business/lib/tirreno.ts:1-34`) — no score is ever read back. Bot has no refund/cancel/ban tool | — | — |
| D7 | Sub-processor inventory | ISSUE | High | See §4. Privacy policy omits ~8 vendors and names the wrong host | Rebuild `page.tsx` §5 from §4; add a host-side privacy page (none exists) | M |
| D8a | Durable Objects jurisdiction | **OK** *(resolved)* | Low | **Verified against the deployed worker**: `getUserNamespace` calls `env.USER_THREAD_DO.jurisdiction("eu")`. DO storage persists **identifiers only** (`pending:${messageId}` → `{messageId, threadId, recipientId, deadline}`), 5-min TTL, deleted on alarm — message *bodies* are only pushed over an open socket, never stored | Caveat: the `try/catch` silently falls back to a non-jurisdictional namespace if `.jurisdiction()` throws. Make that fail loudly | S |
| D8b | **R2 bucket does not exist in the account** | ISSUE | High | Code unambiguously targets Cloudflare R2 (`apps/business/lib/s3.ts:1-67`, `R2_*` env vars, `.eu.r2.cloudflarestorage.com`). **A live `r2_buckets_list` against the Cloudflare account returned `{"buckets":[],"count":0}`**, while `workers_list` confirms `ob-durableobjects` *is* in that same account | Either uploads are broken in production, or images live in a second, undisclosed Cloudflare account. Must be reconciled — it determines where guest/property images are stored for the privacy policy | S to diagnose |
| D8c | Database region | **OK** | — | Neon `eu-central-1`, Upstash `eu-west-2` per `docs/superpowers/specs/2026-09-25-upstash-redis-caching-design.md:280,284`; Scaleway registry `nl-ams` (`ci.yml:19-20`) | — | — |

### E · Tax reporting & registrations

| ID | Check | Verdict | Sev | Evidence | Proposed fix | Effort |
|---|---|---|---|---|---|---|
| E1 | DAC7 fields | ISSUE | High | See gap table below. **No DAC7 report/XML generation code exists anywhere** | Add missing columns + quarterly aggregation + XML exporter | L |
| E2 | Registration numbers | ISSUE | High | No listing-type field (`rooms.roomType` `schema.ts:119` is free-text room category, not accommodation class). No STR/tourism registration field anywhere — `accounts.ts:35` `registration_number` is the KVK number sent to Stripe. Onboarding has **no zod validation at all**; dashboard does (`property/_lib/schema.ts:106,141`) | Add `accommodation_type` + `str_registration_number`; `.superRefine` on `country`; port validation into onboarding | M |
| E3 | VIES validation | ISSUE | Med | No VIES integration; `vatNumber` validated only as non-empty text (`legal-n-boring.tsx:159`, `property/_lib/schema.ts:146`) — not even a format regex. No consultation number stored | Call VIES at onboarding; store `vies_valid`, `vies_consultation_number`, `vies_checked_at` | M |
| E4 | Fee constants | ISSUE | High | Seven distinct locations, two conflicting values — see table below | Single authoritative source; reconcile all copy; update seed | S (unify) / M (with charging path) |
| E5 | Invoicing | ISSUE | Med | No invoice-issuing code, no `invoices` table, no Gotenberg usage, no NL/BE VAT branching, no gapless numbering. Docs themselves say "not yet available" (`your-statement.mdx:10`, `tax-and-reporting.mdx:9`) | Build invoicing when commission charging is wired (§A3d) | L |

**E1 · DAC7 gap table.** Note `org_profile` is **raw-SQL-only** (`packages/db/drizzle/0011_org_iam.sql:29-40`), never modelled in Drizzle — so `schema.ts` is not authoritative for the seller entity.

| DAC7 field | Present? | Evidence |
|---|---|---|
| Legal name | OK | `org_profile.legal_entity_name` (`0011_org_iam.sql:31`) |
| Primary address | **MISSING** | `org_profile` has no address columns; only per-listing `properties.address*` (`schema.ts:77-81`) |
| TIN (BSN/RSIN/foreign) | **MISSING** | No TIN field anywhere; VAT ≠ TIN under DAC7 |
| VAT number | OK | `org_profile.vat_number` (`:33`) |
| Business registration no. | PARTIAL | `kvk_number` (`:32`) is NL-only; no BCE/KBO field for BE; collected as **optional** (`legal/client.tsx:48-53`) |
| Date of birth | **MISSING** | No DOB field; `business_type:'company'` hardcoded (`accounts.ts:27`) makes individual sellers structurally unreachable |
| Financial account id | OK (via Stripe) | `org_profile.stripe_account_id`; IBAN collected in Stripe hosted onboarding |
| Per-listing address | OK | `schema.ts:77-81` |
| Cadastral number | **MISSING** | No field anywhere |
| Quarterly days + consideration | **MISSING** | Per-booking rows exist (`schema.ts:476-558`) but no rollup, view or job |

**E4 · Every commission/fee value found**

| Value | Location |
|---|---|
| 0.035 | `packages/db/src/schema.ts:89` — `properties.commission_rate` DEFAULT (**never read by any code**) |
| 0.035 | `apps/web/sql/ddl.sql:195` — duplicate DDL |
| 0.035 | `packages/db/seed/demo-booking.ts:39,50` — `BOOKING_FEE_RATE`, the only place 3.5% touches money |
| 0.00 | `packages/db/src/schema.ts:145` — `rate_plans.booking_fee_rate`, a second unused fee column |
| 0.045 | `apps/business/lib/analytics/derive/totals.ts:4` — `COMMISSION_RATE`, the only place 4.5% touches money (dashboard display only) |
| 0.045 | `apps/business/app/(dashboard)/dashboard/analytics/_components/revenue-section.tsx:75` — "commission: 4.5% of net room revenue" |
| 0.045 | `apps/business/components/business/CostCalculator.tsx:6` — `OB_RATE` |
| 4.5% | `RateLock.tsx:77`, `Mechanism.tsx:18,25,30,66`, `FinalCTA.tsx:22`, `FAQ.tsx:7,15` — marketing copy |
| 3.5% vs 4.5% | `apps/docs/content/docs/business/getting-paid/how-commission-works.mdx:21` — the docs already flag this discrepancy in a warning callout |

### F · Security & OSPS baseline

| ID | Check | Verdict | Sev | Evidence | Proposed fix | Effort |
|---|---|---|---|---|---|---|
| F1 | Per-request auth / IDOR | **OK** | — | **No IDOR found.** Every handler taking a resource ID verifies ownership for that exact ID via `packages/authz/src/index.ts:55-69` (`PROPERTY_EDIT_ACCESS_SQL`), `userOwnsProperty/Room/RatePlan`, or `getThreadForParticipant` (`:145`, tenant scope inside the query). There is **no `middleware.ts`** — this repo uses `proxy.ts`, whose matcher excludes `/api/*`, and every route handler was confirmed to check independently. `upload/confirm` and `publishAriChanges` are exemplary | — | — |
| F1-1 | `pii-retention` non-constant-time compare | ISSUE | Med | `pii-retention/route.ts:25` plain `!==` | Reuse `bearerAuthorized` | S |
| F1-2 | `property-images/[id]` skips `sessionForApp` | ISSUE | Low | `:18`, `:59` call `auth.api.getSession` raw; every other business route uses `getServerSession` | Use `getServerSession()` | S |
| F1-3 | `apps/web` checkout skips `sessionForApp` | ISSUE | Low | `checkout/route.ts:184-189` | Use `getServerSession()` | S |
| F1-4 | `upload/presign` unbounded, key not bound to user | ISSUE | Low | `presign/route.ts:17-51` no rate limit; `confirm` proves key *shape* only (`:42`), so host A can attach host B's public image | Record issued keys against `session.user.id`; rate-limit presign | M |
| F1-5 | Rate limiting is per-instance in-memory | ISSUE | Low | `apps/business/lib/rateLimit.ts:11` `new Map()`; gates magic links and the guest-PII thread cap. Multiplies by replica count | Back with the existing Upstash Redis | M |
| F2a | **Step-up on payout changes** | ISSUE | **High** | `stripe/account-link/route.ts:7-17` — session check only. `isStepUpFresh` has **no call sites outside `packages/auth/src/host.ts`**. Mechanism itself is sound (DB-read `lastVerifiedAt`, 15-min max age, `shared.ts:437`) | Gate on `isStepUpFresh`, return 403 `STEP_UP_REQUIRED` | S |
| F2b | Step-up on bulk export | N/A | — | No server export endpoint; `export-button.tsx:28-34` builds a client-side Blob from demo-only data (`get-analytics.ts:52-54`) | Re-audit when analytics is wired to real rows | — |
| F2c | Step-up on org/role changes | Mixed | Med | Enforced for delete/remove-member/role-promotion, and **fails closed** (`shared.ts:466-482`). Gap: **`/organization/invite-member` is not gated** — a stolen session can invite a new owner/admin | Add `invite-member` to `stepUpRequiredForRequest` | S |
| F3 | Chatwoot webhook HMAC | **OK** | — | Verified first, before parse (`index.ts:23-34`); raw body; `timingSafeEqual` over pre-validated 32-byte hex (`signature.ts:50,56`); timestamp bound into HMAC with ±300s absolute window; event-id dedupe via `ON CONFLICT DO NOTHING` (`support.ts:127-136`); secret is `required()` and throws at boot — no bypass | — | — |
| F4a | CSP `script-src 'unsafe-inline'` | ISSUE | Med | `apps/web/next.config.ts:30`, `apps/business/next.config.ts:18` — on the checkout page too | Nonce-based `script-src` + `'strict-dynamic'` via the existing `proxy.ts` | M |
| F4b | `Permissions-Policy` absent | ISSUE | Low | Both `headers()` blocks | Add the header | S |
| F4c | `X-Frame-Options` absent | ISSUE | Low | `frame-ancestors 'none'` present; XFO is a scanner/legacy backstop | Add `DENY` | S |
| F4d | No SRI | ISSUE | Low | CookieYes and PostHog load on the checkout origin unpinned. **Stripe and Turnstile must NOT get SRI** (they version JS in place) | SRI on CookieYes; proxy the PostHog bundle | M |
| F4e | PCI SAQ A | **OK** | — | `ui_mode:'form'` (`checkout/route.ts:220`), Stripe's own `<CheckoutForm>` (`PaymentCard.tsx:5,193`), zero card-data identifiers in first-party code, amounts derived and re-validated server-side (`assertChargeable` `:74-121`). Structurally met; F4a is the residual assessor concern | Fix F4a | M |
| F5a | `SECURITY.md` missing | ISSUE | High | Not present at root or `.github/` | Add with a private reporting route | S |
| F5b | No CI vuln/secret scanning, SBOM or signing | ISSUE | Med | No trivy/grype/CodeQL/gitleaks/syft/cosign in any workflow | Add scanning to `ci.yml` | M |
| F5c | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS` missing | ISSUE | Low | Not present | Add | S–M |
| F5d | No MPL per-file headers | ISSUE | **Low** | 0/481 `.ts`/`.tsx` files | *Downgraded from the section agent's Med.* Repo-level `LICENSE` + `NOTICE.md` is accepted MPL practice; a 481-file sweep is churn | L (not recommended now) |
| F5e | Secrets in git history | **OK** | — | **My own scan of all 280 commits**: no `.env*`, key, cert or credential file ever committed. Only hits are a bare `sk_test_` placeholder in a since-deleted `STRIPE_SETUP.md` and `127.0.0.1` test DSNs in `packages/auth/src/factories.test.ts`, `.github/workflows/ci.yml`, `packages/db/scripts/apply-schema-ci.ts`. All 5 working-tree `.env*` files are gitignored (`.gitignore:37,45`) | — | — |
| F6a | Long-lived Scaleway keys | ISSUE | Med | `SCW_ACCESS_KEY`/`SCW_SECRET_KEY` (`ci.yml:309-320`, `rollback.yml:48-57`). Mitigated by required environment approval | Migrate to OIDC if Scaleway supports it | M |
| F6b | Workflow permissions & pinning | **OK** | — | All workflows declare `permissions:`; every third-party action pinned to a full commit SHA; no `pull_request_target` | — | — |
| F7 | **Worker calls a route that does not exist** *(new)* | ISSUE | Med | The deployed `ob-durableobjects` worker POSTs to `${APPS_BUSINESS_URL}/api/internal/messages/check-delivery` on every offline-fallback alarm. **That route does not exist anywhere in the repo** (`find`/`grep` both empty), so the callback 404s and the pending entry has already been deleted from DO storage. Messages remain durable in Postgres, but the offline-delivery fallback silently never runs | Implement the route, or remove the callback | M |

---

## 3. Notion / documentation drift

Statements in the docs (Notion and the in-repo `apps/docs` site) that the code contradicts. Several of these are worse than drift because the documents are *published*.

| # | Doc statement | Reality | Severity |
|---|---|---|---|
| 1 | **"Payouts are only released after a strict 7-day calendar reconciliation period… the funds are still being held by the platform"** — `apps/docs/.../my-payout-hasnt-arrived.mdx:14`, echoed `when-you-get-paid.mdx:15-16`, `FAQ.tsx:27` | No release mechanism exists in code at all (§A2 is clean). Worse, this is a **published assertion of discretionary control over funds** — the precise opposite of the PSD2 commercial-agent position it is meant to support | **High** — fix the docs first |
| 2 | "Google Cloud — Application hosting and infrastructure" — `apps/web/content/legal/privacy/2026-09-21/en.mdx:137`, `:157` | `apps/web`/`apps/business`/`apps/docs` run on **Scaleway** (`ci.yml:19-20`). *Nuance:* `apps/support-bot` genuinely does use GCP (Cloud Tasks + Cloud Run OIDC), so "GCP" is not purely legacy — but it is not the application hosting | **High** |
| 3 | "monthly reconciliation / statement on the 1st / payout on the 6th" | Does not exist in code in any form | Drift (positive) |
| 4 | Commission is 4.5% (marketing, Partner Agreement, `RateLock.tsx:77` "30 days' notice") | DB default is 3.5% and is never read; 4.5% exists only in the analytics display. The docs themselves already flag this (`how-commission-works.mdx:21`) | **High** |
| 5 | "Cloud Scheduler" cron triggers — `messaging-retention/route.ts:6-15`, `pii-retention/route.ts:12-18` | Deployment is Scaleway; **no scheduler of any kind is configured**, so the retention sweeps likely never run | **High** |
| 6 | `consent_log` table | Does not exist. Only `org_consent`, which is host document signing | High |
| 7 | "autocapture: false" | **Correct** — `client.tsx:148`. Docs right, code right | DRIFT resolved / OK |
| 8 | Postmark as email provider | Dead env vars only (`POSTMARK_API_KEY`, `POSTMARK_SERVER_TOKEN`); actual provider is Lettermint. Same for `TYPESENSE_API_KEY` (superseded by Algolia), `GOTENBERG_URL` (never read), `NEXT_PUBLIC_INTERCOM_APP_ID` (never read). **DocuSeal appears nowhere at all** | Low — delete the dead vars |
| 9 | "Firebase UID" | No Firebase reference anywhere in code | Drift (positive) |
| 10 | "The platform absorbs disputes" — `disputes-and-chargebacks.mdx:14` | Directionally supported by `losses:{payments:'application'}` (`accounts.ts:19`), but there is **no dispute webhook**, so nothing implements it operationally | Med |
| 11 | Reviews | `reviews/index.mdx:12` says "Coming soon" — correct, no reviews table exists. But the guest UI still renders a rating badge (§B4) | Med |

---

## 4. Sub-processor inventory

Rebuilt from code, dependency manifests and `.env.local` **variable names only**. Note: **no `.env.example` files exist in this repo**, and **no host-side privacy page exists** in `apps/business` — hosts currently have no disclosure document at all.

| Vendor | Purpose | Personal data sent | Region | Evidence |
|---|---|---|---|---|
| Neon | Primary Postgres | All account/booking/message data | EU `eu-central-1` | `docs/superpowers/specs/2026-09-25-upstash-redis-caching-design.md:280`; `ci.yml:33-70` |
| Scaleway | Container hosting + registry (web, business, docs) | All request data in transit | EU `nl-ams` | `ci.yml:19-20` |
| Google Cloud | **support-bot** hosting + Cloud Tasks queue | Chatwoot payload incl. guest message content and email | **UNKNOWN** | `apps/support-bot/src/tasks.ts:1-90`; `@google-cloud/tasks` |
| Cloudflare Workers / DO | Realtime message relay | Full message row over socket; **storage holds identifiers only**, 5-min TTL | **EU — verified** `jurisdiction("eu")` in deployed worker | deployed `ob-durableobjects`; `packages/messaging/src/realtime.ts:1-65` |
| Cloudflare R2 | Property/room images | Uploaded images | **DISPUTED** — code targets `.eu.r2.cloudflarestorage.com`, but the account has **zero buckets** | `apps/business/lib/s3.ts:1-67`; live `r2_buckets_list` → `count: 0` |
| Cloudflare Turnstile | Checkout bot check | Browser token, IP | EU/US (SCCs) per policy | `apps/web/app/checkout/_lib/turnstile.ts:1-40` |
| PostHog | Product analytics, session replay | Pseudonymous UUID post-consent; replay with inputs+text masked | EU `eu.i.posthog.com` | `packages/analytics/src/client.tsx:141-166` |
| Sentry | Error tracking | Stack traces, browser type | **UNKNOWN** (DSN not in repo) | `apps/business/next.config.ts:76-93` |
| Lettermint | Transactional email | Email address, booking details | EU per policy | `packages/mailing/src/index.ts:1-19` |
| Algolia | Destination search | Search queries, IP | EU per policy | `apps/web/lib/algolia.ts:1-6` |
| Stripe / Connect | Payments, payouts | Name, email, amount, connected-account data | US/EU (SCCs) | `packages/stripe/src/*` |
| Upstash Redis | Read-through cache | Cached query results | EU `eu-west-2` | `packages/cache/src/redis.ts:85-86` |
| Chatwoot | Guest support conversations | Full message content, guest email | **UNKNOWN** (self-hosted) | `apps/support-bot/src/chatwoot/*` |
| Mistral AI | Support bot LLM | Guest message text (no email/name injected by code) | **UNKNOWN** | `@mistralai/mistralai`; `apps/support-bot/src/agent/loop.ts` |
| Tirreno | Fraud signal (write-only) | userId, IP, user agent | **UNKNOWN** (self-hosted) | `apps/business/lib/tirreno.ts:1-34` |
| MapTiler | Map tiles | Location queries | **UNKNOWN** — *not disclosed in policy* | `apps/web/components/GeneralMap.tsx` |
| CartoDB | Basemap tiles | IP | **UNKNOWN** — *not disclosed* | `apps/business/next.config.ts:23` |
| Dicebear | Generated avatars | Seed string only | **UNKNOWN** — *not disclosed* | `apps/business/next.config.ts:20` |
| Google OAuth | Sign-in | Email, name, picture | Disclosed for guests only | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID_BUSINESS` |
| Microsoft OAuth | Host sign-in | Email, name, tenant id | **Not disclosed anywhere** | `MICROSOFT_CLIENT_*`; `packages/auth/src/shared.ts` |
| Apple Sign-In | Sign-in | Email (possibly relay), name | **Not disclosed anywhere** | `APPLE_CLIENT_ID`, `APPLE_KEY_ID`, `APPLE_TEAM_ID` |

**Configured but unused (delete or wire up):** `POSTMARK_API_KEY`, `POSTMARK_SERVER_TOKEN`, `EMAIL_PROVIDER`, `TYPESENSE_API_KEY`, `GOTENBERG_URL`, `NEXT_PUBLIC_INTERCOM_APP_ID`, plus client-side Chatwoot vars with no widget embed. DocuSeal: no trace anywhere.

---

## 5. Questions for Wouter

Only what the code could not answer.

1. **Where are refunds issued today?** No refund code exists, and hosts have no Stripe dashboard. Is this manual platform-side, or genuinely not built? (§A4)
2. **Is commission being collected at all right now?** `application_fee_amount` is disabled and `commission_rate` is never read. Out-of-band invoicing, or unbuilt? (§A3d)
3. **Is the Adyen migration real and imminent?** `apps/business/components/dashboard/status-bar.tsx:95` mentions "migrating payment processing to Adyen". If so, several §A fixes should wait. (§A)
4. **Where do property images actually live?** Code targets R2; the audited Cloudflare account has zero buckets but does hold `ob-durableobjects`. Second account, or are uploads broken? (§D8b)
5. **Do the retention cron routes run on any schedule in production?** Nothing in-repo triggers them. Check the Scaleway console. (§D4b)
6. **Which commission rate is contractually correct — 3.5% or 4.5%?** Signed Partner Agreements promise 4.5% with 30 days' notice; the DB defaults to 3.5%. This determines whether existing hosts must be notified. (§E4)
7. **Does the live Chatwoot inbox greeting disclose that the bot is AI?** Configured in the Chatwoot admin UI, outside this repo. (§C1b)
8. **Is the Sentry DSN on the EU region?** The DSN value is not in the repo. (§D2d)
9. **What are Mistral's DPA retention/training terms?** Code-level minimisation is sound; the contract is not visible here. (§C2)
10. **Regions for Google Cloud (support-bot), the Chatwoot instance and Tirreno?** None stated in code. (§4)

---

## 6. Scope caveats

- The guest checkout path is pinned to one seeded booking (`booking.ts:21`) and no code creates bookings. Most §A and §E findings are unbuilt features, not regressions — severity reflects launch risk, not current breach.
- `org_profile`, `organization`, `member`, `session` and `verification` live in hand-applied SQL or are Better Auth-managed outside `packages/db/src/schema.ts`. Findings about them are inferred from migration SQL; a migration applied outside this repo would not be visible.
- The `ob-durableobjects` source is in a separate repo. I audited the **deployed** bundle via the Cloudflare API, which is authoritative for what is running but may differ from that repo's HEAD.
- Uncommitted working-tree changes touch `packages/auth/src/callbackUrl.ts` and delete `apps/business/lib/safe-redirect.ts`. The login-link redirect allowlist is worth re-checking once those land.
- `apps/docs` route handlers were out of scope; they carry no auth surface or tenant data.
