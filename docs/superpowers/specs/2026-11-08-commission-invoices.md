# Monthly commission invoices (in-house)

**Owner:** Wouter · **Date:** 8 November 2026 · **Status:** Phase 0 approved
**Design:** canvas "Commission invoice — demo", https://claude.ai/artifact/Bp54LhFSwi1LmbSYHWQmGB (NL invoice, specification page, BE reverse-charge invoice)

This is the handoff Wouter wrote, with the decisions taken at Phase 0 folded in. Where the two differ, **the decisions below win**.

## Decisions taken at Phase 0 (8 Nov 2026)

1. **The commission is VAT-inclusive.** The fee stays what checkout already charges: `applicationFeeCents(rooms_total_cents, properties.commission_rate)`, i.e. 4.5% of the stay **including VAT, excluding tourist tax**. Nothing is added on top.
   - `NL_DOMESTIC`: the fee contains 21% VAT. `net = roundHalfUp(fee × 10000 / 12100)`, `vat = fee − net`.
   - `EU_REVERSE_CHARGE`: `net = fee`, `vat = 0`.
   - "Accommodation value" on invoices is the stay incl. VAT, excl. tourist tax.
   - Where the canvas says otherwise it is adapted: NL subtotal = net, "VAT 21%" = the VAT inside the fee, Total = the fee Stripe took; footer reads "…price of the stay including VAT, excluding tourist tax"; the specification's "Net, excl. VAT" row becomes "Total commission".
2. **The split is stored on the booking** at checkout: `commission_rate`, `commission_vat_treatment`, `commission_net_cents`, `commission_vat_cents` (the fee itself is the existing `commission_cents`; the base is the existing `rooms_total_cents`).
3. **`billing_profiles` is its own table**, keyed by organization with `ON DELETE RESTRICT`. `org_profile` is left alone (it cascades). An organization with billing records cannot be deleted.
4. **The application fee is live in production.**
5. **PDFs are made with `pdfkit`**, in process. No @react-pdf/renderer, no Gotenberg.
6. **Docker:** keep `bun install --frozen-lockfile`, like every other Dockerfile in the repo.
7. **Platform webhook** lives in `apps/business` at `/api/stripe/platform-webhook` with its own secret `STRIPE_PLATFORM_WEBHOOK_SECRET`, subscribed (as "Events on your account") to `application_fee.created` and `application_fee.refunded` only.

Decided in plan review (8 Nov 2026):

8. **Every payment without a booking is returned.** A payment is "booked" only when a confirmed booking's `stripe_payment_intent_id` is that payment. Everything else (oversold, a second payment for an intent that is already booked, or a payment we cannot explain at all) is refunded to the guest in full, application fee included. Oversold and duplicate payments already are (`refundInFull`); an unexplained payment is refunded by the ledger the moment it is seen, logged in `audit_log` (`payment.unexplained-returned`) and reported to Sentry. Its fee and fee refund are still recorded in the ledger with `disposition = 'returned'`, so the ledger always equals Stripe, but returned entries never appear on an invoice. Each quarter's report includes a CSV of returned payments, so Stripe's total = invoiced + returned, with nothing unexplained.
9. **No booking or going live without the minimum in place.** A property is *ready* only when: its organization has a connected Stripe account that can take charges; rates are confirmed tax-inclusive; the property's legal details (legal company name, VAT number) are filled; the organization's billing profile is complete; and for reverse-charge hosts, the VAT ID is VIES-valid. Publishing refuses a property that is not ready, and checkout refuses to sell one (guest sees "This property can't take bookings right now"). The VAT treatment at checkout therefore always comes from the billing profile; there is no fallback to the property's country. The gate can be switched off with `PROPERTY_READINESS_ENFORCE=off`, only for the first deploy while existing hosts' billing details are backfilled.
10. **A document only for real activity.** A host gets a document for a month only if that month has at least one booked entry: a fee on a confirmed booking, or a refund of one. Months whose only activity is returned payments get nothing. A confirmed booking that is fully refunded in the same month still gets a €0.00 invoice.
11. **A `billing` permission.** New resource `billing: ["read", "update"]`, granted to owner, general manager (`admin`) and `finance`. Viewing invoices and activity needs `billing:read`; editing billing details needs `billing:update`, not `org:update`.
12. **Hosts see the current period.** Drafts stay internal, but Billing shows an "Upcoming invoice" view: this month's running fees and refunds, the totals as the next invoice will compute them, how they will be taxed ("21% Dutch VAT included" or "Reverse charge, VAT ID verified on …"), and anything that would block the invoice (incomplete details, VAT ID not verified).
13. **R2 bucket lock.** R2 has no governance/compliance modes: a lock rule can be removed by anyone holding a token with bucket-admin rights. Start the test bucket with a short retention (1 day) to prove the behaviour, then put the 8-year rule on production. The job's token gets object read/write only; the admin token that could remove the rule is kept out of every app.

## Phase 0 findings this builds on

- No commission ledger exists. Fee refunds are only in `audit_log` (`action = 'commission.refunded'`).
- Both existing Stripe endpoints are Connect endpoints; nothing receives platform events.
- `bookings.stripe_payment_intent_id` holds the `pi_…`; `fee.charge` is the `ch_…` on the host's account.
- `org_profile` has `legal_entity_name`, `kvk_number`, `vat_number`; no address, country, billing email or VIES result.
- R2 client: `apps/business/lib/s3.ts` (`@aws-sdk/client-s3`, EU endpoint via `R2_ENDPOINT`). Lettermint 2.8.0 (`attach`, `idempotencyKey`). Bun app Docker pattern: `apps/support-bot/Dockerfile`. Migrations: hand-written `packages/db/drizzle/00NN_*.sql`, applied by `db:migrate:ci`.
- Booking reference shown to guests and hosts: `bookingId.slice(0, 8).toUpperCase()`.

## Goal

Once a month, issue every host one invoice for the OpenBookings commission collected in the previous month. Store the invoices in our database and in R2, and email them to the host. No accounting software: we do the numbering, rendering, storage and VAT-return data ourselves.

The commission was already collected via Stripe application fees at payment time, so the invoice is a VAT document marked "Paid — nothing to pay". It never asks for payment.

## Fixed rules

| Topic | Rule |
|---|---|
| Commission | VAT-inclusive, see decision 1 |
| VAT treatment | NL host: `NL_DOMESTIC` 21% inside the fee. EU host outside NL: `EU_REVERSE_CHARGE`, needs a VIES-valid VAT ID. Non-EU: refused |
| Hosts | Businesses only (B2B) |
| Month of an entry | The month of the fee's / refund's Stripe `created`, Europe/Amsterdam |
| Refunds | Negative line on the refund month's invoice, referencing the original invoice number(s). A month that nets negative is a **credit note** |
| Months with no entries | No document; see decision 10 |
| Layout | Page 1: invoice with 2 summary lines (commission, refunds), totals, "Paid" notice. Page 2+: specification per booking. Plus a CSV of the specification. Follows the canvas |
| Personal data | No guest data on invoices or in billing tables: booking reference and stay dates only |
| Language / currency | English, EUR |
| Numbering | One series per calendar year, `OB-2026-0001`, gapless, assigned only at issue |
| Storage | R2 bucket `ob-invoices`, EU jurisdiction, bucket lock 8 years on `invoices/` |
| Delivery | Lettermint email with PDF + CSV attached. List and download in `apps/business` |
| Approval | Cron creates drafts; Wouter runs issue and deliver by hand after review |

## Schema

All money is signed integer cents (`bigint`), all timestamps `timestamptz`. Billing records are kept 7+ years: no cascading deletes (`ON DELETE RESTRICT`), excluded from GDPR deletion runs as a legal obligation, listed in `docs/privacy/data-map.md` with that note.

**`commission_entries`** (the ledger): `id`, `kind` (`fee` | `fee_refund`), `billing_entity_id` (organization), `property_id`, `booking_id` (nullable: a payment refunded as oversold/duplicate never became a booking), `booking_intent_id`, `booking_ref`, `stay_start`, `stay_end`, `stripe_account_id`, `stripe_application_fee_id`, `stripe_fee_refund_id`, `stripe_payment_ref` (the `ch_…` the host sees), `base_amount`, `commission_net`, `vat_rate_bp` (2100 or 0), `vat_amount`, `gross_amount`, `vat_treatment`, `currency` (`eur`), `occurred_at`, `invoice_id`, `refunds_entry_id`, `disposition` (`booked` | `returned`, decision 8), `amount_mismatch` (boolean), `created_at`. A `returned` fee has `booking_id` NULL and is never linked to an invoice.
Constraints: `UNIQUE (stripe_application_fee_id) WHERE kind = 'fee'`; `UNIQUE (stripe_fee_refund_id)`; `CHECK (gross_amount = commission_net + vat_amount)`; append-only trigger (no DELETE; UPDATE only `invoice_id` NULL → value).

**`billing_profiles`**: `organization_id` (pk, FK restrict), `legal_name`, `address_line1`, `address_line2`, `postal_code`, `city`, `country_code`, `vat_id`, `kvk_number`, `vat_id_checked_at`, `vat_id_valid`, `vies_request_id`, `billing_email`, `updated_at`.

**`invoice_sequences`**: `series` pk, `next_value int not null default 1`.

**`invoice_runs`**: `id`, `period_start`, `step` (`backfill` | `draft` | `issue` | `store` | `deliver` | `report`), `status` (`running` | `succeeded` | `blocked` | `failed`), `started_at`, `finished_at`, `report jsonb`.

**`invoices`**: `id`, `run_id`, `billing_entity_id`, `period_start`, `period_end`, `doc_type` (`invoice` | `credit_note`), `status` (`draft` | `issued` | `sent`), `series`, `sequence_number`, `number` (unique), `issued_on`, `seller`, `buyer` (jsonb snapshots), `vat_treatment`, `vat_rate_bp`, `fee_count`, `fee_base_total`, `fee_gross_total`, `refund_count`, `refund_base_total`, `refund_gross_total`, `refers_to_invoice_numbers text[]`, `net_total`, `vat_total`, `gross_total`, `vat_collected`, `vat_rounding_diff`, `pdf_key`, `pdf_sha256`, `csv_key`, `csv_sha256`, `sent_at`, `email_message_id`.
Constraints: `UNIQUE (billing_entity_id, period_start)`; immutability trigger: once `status <> 'draft'` only `status` (`issued` → `sent`), `pdf_*`/`csv_*` (NULL → value), `sent_at`, `email_message_id` may change; DELETE only while `draft`.

## Ledger ingestion

`recordApplicationFee(fee)` and `recordApplicationFeeRefund(feeRefund)` in `packages/billing`. The webhook and the reconciliation backfill both call them. Idempotent via the unique constraints.

- Fee: resolve the payment. Booked (a confirmed booking whose `stripe_payment_intent_id` is this payment): take base / net / VAT / treatment from the booking's checkout split (legacy bookings without it: compute from `commission_cents` and the billing profile's treatment). Not booked: `disposition = 'returned'`; if the payment has not been fully refunded yet, refund it now (full, `refund_application_fee: true`). If `fee.amount ≠ net + vat`: insert anyway with the Stripe amount re-split, set `amount_mismatch`, report to Sentry.
- Fee refund, full: the original's values negated. Partial, `r` = refund amount, `g` = original gross, `rate` = original `vat_rate_bp`: `vat = r − roundHalfUp(r × 10000 / (10000 + rate))`, `net = r − vat`, `base = roundHalfUp(original.base × r / g)`, all stored negative.

## The job (`apps/invoice-job`)

`bun run src/main.ts --step=backfill|draft|issue|store|deliver|report --period=YYYY-MM [--from=YYYY-MM] [--quarter=YYYYQn] [--dry-run] [--entity=<id>] [--preview]`. `backfill` runs the reconciliation (step 2) for every month from `--from` to the previous month, without drafting. Default period: previous month in Europe/Amsterdam. Each step idempotent and resumable; each run writes an `invoice_runs` row.

1. **Period bounds**: half-open `[1st 00:00 Amsterdam, next 1st 00:00 Amsterdam)`, DST-correct.
2. **Reconcile (blocking)**: list platform balance transactions of type `application_fee` and `application_fee_refund` created in the period; missing in ledger → backfill, then compare again; in ledger but not in Stripe, or amount mismatch → run `blocked`, no drafts.
3. **Profiles**: block an entity (report it, leave its entries) when required fields are missing, treatment is mixed within the month, or (reverse charge) VIES says invalid. VIES re-checked when older than 30 days via the EC VIES REST API, `vies_request_id` stored; unavailable after 3 tries with backoff → block with `vies_unavailable`.
4. **Draft**: per entity with at least one booked entry in the period (decision 10), aggregate the period's un-invoiced booked entries; a returned fee that is not fully refunded yet is returned now, and blocks the run if that fails; `gross_total = Σ gross`; NL: `net_total = roundHalfUp(gross_total × 10000 / 12100)`, `vat_total = gross_total − net_total`; RC: `net_total = gross_total`, `vat_total = 0`; `vat_collected = Σ vat_amount`; `vat_rounding_diff = vat_total − vat_collected`; `doc_type = gross_total < 0 ? credit_note : invoice`. Referenced invoice numbers from the refunded entries' invoices. Upsert on `(billing_entity_id, period_start)`; a rerun replaces a draft and never touches an issued document. Run report emailed to Wouter (Lettermint) and posted to Slack if `SLACK_WEBHOOK_URL` is set. `--preview` writes a watermarked DRAFT PDF to local disk; drafts never go to R2.
5. **Issue**: one transaction per invoice: lock the series row, take `next_value`, increment, set number `OB-YYYY-NNNN`, `issued_on`, seller/buyer snapshots, link entries (`affected = fee_count + refund_count` or rollback). Never a Postgres `SEQUENCE`. Then render (from snapshot + linked entries only; only while `pdf_key IS NULL`) and store in R2: `invoices/{yyyy}/{number}.pdf`, `invoices/{yyyy}/{number}-specification.csv`; HEAD first, same sha256 → mark stored, different → stop and alert.
6. **Deliver**: every `issued` invoice with `sent_at IS NULL`: email `billing_email` with PDF + CSV, idempotency key = invoice id, then `status = 'sent'`, `sent_at`, `email_message_id`.
7. **Report**: `--step=report --quarter=2026Q4` exports `v_vat_return_quarter`, `v_icp_listing_quarter`, `v_dac7_fees_quarter` as CSV. All three are built on issued documents and their linked entries.

**PDF page 1**: seller and buyer blocks with VAT IDs, KvK, number, issue date, service period; lines "Commission on bookings" and "Commission refunded on cancellations" (with "relates to invoice …"); subtotal, "VAT 21%" or "VAT reverse charged — Article 196 Directive 2006/112/EC" at €0.00, total; "Paid — nothing to pay. This commission was collected per booking via Stripe at the moment the guest paid."; disclosed-agent footer. A credit note is titled "Credit note". **Page 2+**: columns Booking, Paid, Stay, Accommodation value, Commission 4.5%, Stripe payment; refund rows marked and referencing the original invoice; totals block. No guest names.
**CSV**: same rows, UTF-8, `;`-separated, amounts as decimals with `.`.

## Host UI (`apps/business`, Finance → Billing)

Invoice list (number, period, type, net, VAT, total, status), PDF/CSV download via presigned URL (5 min TTL), the "Upcoming invoice" view (decision 12), the billing details form, and a readiness checklist (decision 9). Access checked on every request (org membership via `getOrgScopedDb` + `billing:read` / `billing:update`), never by layout alone.

## Rollout order

1. Deploy with `PROPERTY_READINESS_ENFORCE=off`. Backfill and verify every existing host's billing details (script pre-fills from `org_profile` and the Stripe account; Wouter checks the gaps; VIES-check every reverse-charge host). Then remove the switch so the readiness gate is on.
2. Set up R2: test bucket with a 1-day lock first, then `ob-invoices` with the 8-year rule (decision 13).
3. Enable the Stripe platform webhook, so new fee events resolve against complete billing profiles.
4. Dry-run the historical backfill (`--step=backfill --dry-run`) from the first month with fees, review it, run it for real, and only then enable the Scaleway cron.

## Operations

- Container: Turborepo prune + Bun, like `apps/support-bot`.
- Scaleway Serverless Job in `nl-ams`, cron time zone Europe/Amsterdam: `--step=draft` at `0 6 1 * *`; issue and deliver manual for now. Hard deadline: issue by the 15th of the following month.
- Sentry: cron monitor on the draft step; errors from every step.
- Secrets: env vars.

## Guards (refuse, don't warn)

- Seller config incomplete (`SELLER_LEGAL_NAME`, `SELLER_ADDRESS`, `SELLER_KVK`, `SELLER_VAT_ID`, `SELLER_BILLING_EMAIL`) → refuse `--step=issue` in live mode; test mode may use placeholders.
- Live Stripe key against a non-production database, or the reverse → refuse.
- Reconciliation for the period not `succeeded` → no issue.

## Tests

Unit: `roundHalfUp` edges; split for both treatments; partial-refund split sums; period bounds across DST (March, October); draft aggregation incl. credit note and zero total; referenced invoice numbers; CSV format.
Database (Neon test branch): append-only and immutability triggers; 20 parallel issues → no duplicates, no gaps; draft→draft, issue→issue, deliver→deliver idempotent.
Integration (Stripe test mode, skipped without `STRIPE_TEST_SECRET_KEY`): NL and BE host direct charges with fees, one full and one partial refund; draft, issue, deliver; ledger = Stripe, two documents with correct totals, files in the test bucket, emails sent once.

## Acceptance

- Every application fee and fee refund in Stripe has exactly one ledger entry.
- A draft run gives one draft per eligible host plus a blocker report, and changes nothing issued.
- Issued invoices have gapless numbers, are immutable, and each linked entry belongs to exactly one invoice.
- The PDF matches the canvas (as adapted), has no guest data, and its totals equal the specification and the database.
- Objects are in the locked EU bucket and the stored sha256 matches.
- Hosts get one email per invoice and can download it in `apps/business`.
- VAT-return, ICP and DAC7 exports are correct for a test quarter.
- All tests pass; the PR description has the Phase 0 report and one NL and one BE PDF screenshot.
