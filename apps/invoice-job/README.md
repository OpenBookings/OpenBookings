# invoice-job

The monthly commission-invoice job (spec: `docs/superpowers/specs/2026-11-08-commission-invoices.md`).
A Bun CLI that runs **one step per invocation** and exits. It wires the database, Stripe, VIES, R2,
Lettermint, Slack and Sentry into the steps in `@openbookings/billing`. In production it runs as a
Scaleway Serverless Job.

```
bun run apps/invoice-job/src/main.ts --step=<step> [options]
```

| Step | What it does | Options |
| --- | --- | --- |
| `draft` | Reconciles the month's ledger against Stripe (blocking), then drafts one document per eligible host. Prints the run report, and emails it (plus Slack) unless it is a dry run. | `--period`, `--dry-run`, `--entity` |
| `draft --preview` | Renders one host's current draft to `out/DRAFT-{entity}-{period}.pdf`, watermarked DRAFT. Seller from `SELLER_*` (placeholders when missing), buyer from the host's billing profile as it is now. Writes nothing to the database or R2. | `--entity` (required), `--period` |
| `issue` | Issues the month's drafts (gapless `OB-YYYY-NNNN` numbers, seller and buyer snapshots), then runs `store`. Refused unless the month's last real draft run reconciled successfully. | `--period`, `--entity` |
| `store` | Renders and uploads the PDF and CSV of every issued invoice that is not stored yet. Retry this on its own after a failed upload. | `--period` |
| `deliver` | Emails every stored, issued invoice that is not sent yet (PDF and CSV attached, invoice id as idempotency key). | `--period` |
| `report` | Writes the quarter's VAT-return, ICP, DAC7, returned-payments and Stripe-reconciliation CSVs to `out/`. | `--quarter=YYYYQn` (required) |
| `backfill` | Reconciles every month from `--from` through last month, one run per month, and prints `backfilled / returned / blockers` per month. Drafts nothing, and never counts as a draft run. | `--from=YYYY-MM` (required), `--dry-run` |

- `--period=YYYY-MM` defaults to **last month in Europe/Amsterdam**, and must be a month that is over.
- `--dry-run` (draft, backfill) does everything inside a transaction that is rolled back: no rows kept, no
  payment returned, no email. The run itself is still recorded, marked `dryRun`, and never unlocks issuing.
- A flag a step has no use for is refused, not ignored.
- Every run writes an `invoice_runs` row (`running` → `succeeded` / `blocked` / `failed`) with its report.
- **Exit codes:** `0` succeeded, `2` blocked (something needs a human: reconciliation blocked, a host blocked
  or skipped, a file conflict, a send failure), `1` failed (bad arguments, a guard refused, or an error).

## Guards

- **Live/test mode:** live when `STRIPE_SECRET_KEY` is a live key (`sk_live_…`, or a restricted `rk_live_…`).
  The database counts as production only when `INVOICE_DB_ENV=production`. A live key against any other
  database, or a test key against production, is refused before anything runs.
- **Seller:** in live mode `--step=issue` refuses to run until every `SELLER_*` variable is set. Test mode
  prints `[SELLER_…]` placeholders instead.
- **Reconciliation:** `--step=issue` refuses unless the month's latest real (not dry-run) draft run reconciled
  successfully. A backfill never stands in for a draft run.

## Environment

| Variable | Used by | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | all | Postgres. Use Neon's **direct** endpoint (not `-pooler`): the job drives explicit transactions and needs its session timeouts, which the pooler drops. |
| `INVOICE_DB_ENV` | all | `production` when `DATABASE_URL` is the production database; leave unset (or anything else) for dev and test branches. Must agree with the Stripe key. |
| `STRIPE_SECRET_KEY` | all | The platform's Stripe secret key (`sk_live_…` / `sk_test_…`). Reads balance transactions, application fees and their refunds, and connected-account charges; refunds a payment that has no booking (spec decision 8). |
| `PG_STATEMENT_TIMEOUT_MS` | all | Optional. Per-statement cap; the job defaults it to `120000` (the web apps use 15 s). |
| `PG_IDLE_TX_TIMEOUT_MS` | all | Optional. Idle-in-transaction cap; the job defaults it to `300000`. |
| `SENTRY_DSN` | all | Optional. Errors from every step, plus the cron monitor `invoice-draft` on the draft step. Off when unset. |
| `VIES_REQUESTER_VAT` | draft | OpenBookings' own Dutch VAT number (`NL…B01`). Sent with every VIES check so VIES issues a request identifier, which is stored as proof. |
| `INVOICE_REPORT_EMAIL` | draft | Where the run report is emailed after a real (not dry) draft run. Required for it. |
| `SLACK_WEBHOOK_URL` | draft, store, deliver | Optional Slack incoming webhook: the run report summary, and alerts for file conflicts and failed sends. |
| `LETTERMINT_PROJECT_TOKEN` | draft, deliver | Lettermint project token: the run report and the invoice emails. |
| `EMAIL_FROM_ADDRESS` | draft, deliver | Optional sender, as for the other apps (`@openbookings/mailing`). |
| `SELLER_LEGAL_NAME` | issue, preview | OpenBookings' legal name on every invoice. |
| `SELLER_ADDRESS` | issue, preview | Address lines separated by newlines (or a literal `\n`), ending with "postcode city". The country is always the Netherlands. |
| `SELLER_KVK` | issue, preview | KvK number. |
| `SELLER_VAT_ID` | issue, preview | OpenBookings' VAT id. |
| `SELLER_BILLING_EMAIL` | issue, preview | Contact email printed on the invoice. |
| `INVOICES_R2_ENDPOINT` | store, deliver | The invoice bucket's S3 endpoint (the EU-jurisdiction host). |
| `INVOICES_R2_BUCKET` | store, deliver | `ob-invoices` in production; the test bucket otherwise. |
| `INVOICES_R2_ACCESS_KEY_ID` | store, deliver | An R2 token with **object read/write only**. Never a bucket-admin token: that one can remove the lock rule (spec decision 13). |
| `INVOICES_R2_SECRET_ACCESS_KEY` | store, deliver | Its secret. |

## Monthly runbook

Hard deadline: **everything issued by the 15th** of the month after the period.

1. **1st, 06:00 Amsterdam:** the Scaleway cron runs `--step=draft` for last month. The run report arrives by
   email (and Slack): reconciliation status, drafts by VAT treatment, blocked hosts and why, VAT rounding
   differences.
2. **Review the report.**
   - Reconciliation **BLOCKED**: nothing was drafted. Fix the cause it lists (unknown account, unsettled
     payment, missing profile, ledger ≠ Stripe), then run `--step=draft` again.
   - **Blocked hosts:** fix their billing details (or wait for VIES), then run `--step=draft` again, for all
     hosts or `--entity=<org id>` for one. A rerun replaces drafts and never touches issued documents.
   - To see a host's document before issuing: `--step=draft --preview --entity=<org id>` (locally, writes
     `out/DRAFT-….pdf`).
3. **Issue:** run the job with `--step=issue`. It issues and then stores the PDFs and CSVs in R2. Exit `2`
   means a host was skipped (details changed since the draft: rerun the draft, then issue again) or a file
   conflicts (stop, the job has alerted: never overwrite). If storing failed part-way, run `--step=store`.
4. **Check the PDFs:** download a few in OpenBookings Business → Finance → Billing (or from the bucket) and
   compare totals with the run report.
5. **Deliver:** run the job with `--step=deliver`. Rerunning is safe: sent invoices are skipped and the
   invoice id is the email's idempotency key. Exit `2` lists failed sends and invoices without a billing
   email.

**Each quarter:** `--step=report --quarter=2026Q4`, locally against production (read-only), for the VAT
return, the ICP listing and DAC7. The CSVs land in `out/`.

To run a step by hand in production, use the Scaleway console: *Run job* with contextual options, args
`--step=issue` (or `--step=deliver`, …). The definition's environment and secrets apply.

## Rollout order

From the spec; do these in order.

1. **Readiness gate off, profiles backfilled.** Deploy with `PROPERTY_READINESS_ENFORCE=off`. Backfill and
   verify every existing host's billing details (the profile backfill pre-fills from `org_profile` and the
   Stripe account; check the gaps by hand; VIES-check every reverse-charge host). Then remove
   `PROPERTY_READINESS_ENFORCE` so the readiness gate is on.
2. **R2.** Create the test bucket with a **1-day** lock rule on `invoices/` first and prove the behaviour
   (an object cannot be overwritten or deleted until it expires). Then create `ob-invoices` (EU jurisdiction)
   with the **8-year** rule. Give the job an object read/write token only.
3. **Platform webhook.** In Stripe, add the "Events on your account" endpoint
   `/api/stripe/platform-webhook` on `apps/business` for `application_fee.created` and
   `application_fee.refunded` only, and set its signing secret as `STRIPE_PLATFORM_WEBHOOK_SECRET` on
   `apps/business`. New fee events now land in the ledger against complete billing profiles.
4. **Historical backfill, then the cron.** Dry-run it from the first month with fees:
   `--step=backfill --from=YYYY-MM --dry-run`. Review every month's line (and blockers). Run it for real
   without `--dry-run`. Only then enable the Scaleway cron below.

## Scaleway Serverless Job

- **Image:** `rg.nl-ams.scw.cloud/namespace-distracted-saha/openbookings-invoice-job:main`, built and pushed
  by CI (`build-invoice-job` in `.github/workflows/ci.yml`) on every push to `main` that touches the job or a
  package. CI never rolls anything: the job definition points at the `main` tag.
- **Region:** `nl-ams`.
- **Startup command:** leave empty (the image's entrypoint is `bun run apps/invoice-job/src/main.ts`).
- **Arguments:** `--step=draft`.
- **Cron:** `0 6 1 * *`, time zone `Europe/Amsterdam`.
- **Environment:** every variable above. Put the secrets (`DATABASE_URL`, `STRIPE_SECRET_KEY`,
  `INVOICES_R2_SECRET_ACCESS_KEY`, `LETTERMINT_PROJECT_TOKEN`, `SLACK_WEBHOOK_URL`, `SENTRY_DSN`) in Secret
  Manager and reference them. Set `INVOICE_DB_ENV=production` with the live key.
- **Resources:** 1 vCPU and 1 GB are plenty; give it a timeout of 30 minutes (VIES retries back off up to
  21 s per host).
- Exit codes `1` and `2` both show as a failed run in Scaleway, on purpose: either needs a look.
- **Sentry:** the draft step checks in to the cron monitor `invoice-draft` (same schedule and time zone), so a
  missed or failed 1st-of-the-month run alerts.

## Development

```
bun test                       # args and guards
bun run typecheck
docker build -f apps/invoice-job/Dockerfile .   # from the repo root
```

The image runs the TypeScript source with Bun (no bundle), so pdfkit's data files and the Inter fonts in
`packages/billing/assets/fonts` resolve from the pruned workspace.
