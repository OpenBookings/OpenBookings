# support-bot

The middle layer between Chatwoot (guest support inbox) and Mistral for
OpenBookings: verifies Chatwoot webhooks, runs a grounded function-calling
loop against real reservation/payment data, and posts replies (or escalates
to a human) back into the conversation.

## Flow

```
Guest message → Chatwoot (status: pending) → POST /webhooks/chatwoot
  → verify X-Chatwoot-Signature (+ timestamp) → dedupe (processed_events)
  → enqueue Cloud Task → 200
Cloud Task → POST /tasks/process-conversation (OIDC-authenticated)
  → context from support_context_cache (fallback: Chatwoot messages API)
  → Mistral loop (mistral-medium-latest, max 5 tool iterations)
      tools: get_reservation · get_payment_status · get_cancellation_policy · escalate_to_human
  → final text → Create Message API   |   escalation → private note + status "open"
```

Chatwoot signs `{X-Chatwoot-Timestamp}.{raw_body}`, not the body alone, and
sends the digest as `sha256=<hex>`. Binding the timestamp is what makes the
signature non-replayable, so `src/chatwoot/signature.ts` also rejects
requests outside a 5-minute window.

Escalation is two-layered: the model can call `escalate_to_human`, and
rule-based checks (`src/escalation.ts`) force a hand-off on dispute/chargeback
language or refund activity ≥ `REFUND_ESCALATION_THRESHOLD_EUR` — before or
regardless of model judgment.

Idempotency is two-layered too: the webhook dedupes event ids on insert, and
the task handler checks/sets `processed_events.replied_at` around the
guest-facing post, so Cloud Tasks retries never double-reply.

## Layout

- `src/index.ts` — Hono routes (webhook + task handler)
- `src/process.ts` — the async pipeline per guest message
- `src/agent/` — system prompt (`prompt.ts`), tool registry with Zod-validated
  dispatch (`tools.ts`), Mistral loop (`loop.ts`)
- `src/escalation.ts` — rule-driven escalation checks
- `src/chatwoot/` — signature verification + minimal API client
- `src/tasks.ts` — Cloud Tasks enqueue + OIDC verification

- `src/testing/mocks.ts` — shared `@openbookings/db` / Chatwoot test doubles
  (registered once, because `mock.module` is process-global)

Reservation/cache/idempotency queries live in `@openbookings/db`
(`packages/db/src/support.ts`); the payment summary lives in
`@openbookings/stripe` (`getPaymentSummary`).

The two tables are created by `packages/db/drizzle/0006_support_bot.sql`.
Apply it **by hand** (psql or the Neon SQL editor) — this repo has no drizzle
journal, so `bun run db:migrate` does not track it. Every statement is
idempotent, so re-running the file is safe.

## Environment

```
MISTRAL_API_KEY
CHATWOOT_BASE_URL
CHATWOOT_API_TOKEN
CHATWOOT_ACCOUNT_ID
CHATWOOT_WEBHOOK_SECRET
GOOGLE_CLOUD_PROJECT
CLOUD_TASKS_QUEUE_NAME
CLOUD_TASKS_QUEUE_LOCATION
CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL   # SA the queue mints OIDC tokens for
SERVICE_BASE_URL                    # public URL of this service (OIDC audience)
REFUND_ESCALATION_THRESHOLD_EUR     # optional, default 250
TASKS_AUTH_DISABLED=true            # local dev only: skip OIDC on /tasks/*
```

`DATABASE_URL` and `STRIPE_SECRET_KEY` are read inside `@openbookings/db` and
`@openbookings/stripe` — no separate copies here, but they are still required.

All of the above except the two optional entries are asserted at startup
(`assertRequiredEnv` in `src/env.ts`, called only when `src/index.ts` is the
entrypoint). A revision with incomplete config fails to go live rather than
starting healthy and 500-ing every webhook — which Chatwoot would retry.

## Develop

```sh
bun install
bun run dev   # http://localhost:3000
bun test
bun run build # tsc --noEmit; there is no bundle, Bun runs the TS directly
```

## Testing locally

Two local-dev flags in `.env.local` make the pipeline runnable without GCP:
`TASKS_INLINE=true` dispatches straight to the task handler instead of
enqueueing, and `TASKS_AUTH_DISABLED=true` lets that self-call through. Both
are refused at startup when `NODE_ENV=production`.

```sh
bun run scripts/check-mistral.ts    # key, model, tool schemas, tool calling
bun run dev                         # :3003

# signed webhook, no Chatwoot or tunnel needed
bun run scripts/send-webhook.ts --conversation 1 "what time is check-in?"
bun run scripts/send-webhook.ts --replay --conversation 1 "..."   # idempotency
```

`send-webhook.ts` signs with `CHATWOOT_WEBHOOK_SECRET` exactly as Chatwoot
does, so it exercises the real verification path. `--replay` reuses the
previous message id: the second delivery must return `duplicate: true` and
must not produce a second reply.

Escalation is easiest to check with dispute vocabulary — e.g. `"ik ga een
terugboeking starten via mijn bank"` should post a private note, flip the
conversation to `open`, and never reach Mistral.

To receive real Chatwoot deliveries the webhook URL must be a public domain
(Chatwoot rejects `localhost` and `host.docker.internal`), so run
`cloudflared tunnel --url http://localhost:3003` and register
`https://<subdomain>/webhooks/chatwoot`.

## Deploy

Cloud Run, via `apps/support-bot/Dockerfile` + `cloudbuild.support-bot.yaml`
(same turbo-prune shape as web/business). Non-secret config is set with
`--set-env-vars` from trigger substitutions; secrets come from Secret Manager
via `--set-secrets`, so they never appear in build logs.

`SERVICE_BASE_URL` is both the Cloud Tasks target and the OIDC audience, so
it must equal the service's own public URL. That URL does not exist until the
first deploy — deploy once, then set the substitution and redeploy.

```sh
docker build -f apps/support-bot/Dockerfile -t support-bot .   # from repo root
```
