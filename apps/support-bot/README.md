# support-bot

The middle layer between Chatwoot (guest support inbox) and Mistral for
OpenBookings: verifies Chatwoot webhooks, runs a grounded function-calling
loop against real reservation/payment data, and posts replies (or escalates
to a human) back into the conversation.

## Flow

```
Guest message → Chatwoot (status: pending) → POST /webhooks/chatwoot
  → verify X-Chatwoot-Signature → dedupe (processed_events) → enqueue Cloud Task → 200
Cloud Task → POST /tasks/process-conversation (OIDC-authenticated)
  → context from support_context_cache (fallback: Chatwoot messages API)
  → Mistral loop (mistral-medium-latest, max 5 tool iterations)
      tools: get_reservation · get_payment_status · get_cancellation_policy · escalate_to_human
  → final text → Create Message API   |   escalation → private note + status "open"
```

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

Reservation/cache/idempotency queries live in `@openbookings/db`
(`packages/db/src/support.ts`, migration `0006_support_bot.sql`); the payment
summary lives in `@openbookings/stripe` (`getPaymentSummary`).

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
`@openbookings/stripe` — no separate copies here.

## Develop

```sh
bun install
bun run dev   # http://localhost:3000
bun test
```
