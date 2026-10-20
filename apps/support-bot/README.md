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
  → Mistral loop (MISTRAL_MODEL, max 5 tool iterations)
      tools: get_reservation · get_payment_status · get_cancellation_policy · escalate_to_human
  → final text → Create Message API   |   escalation → private note + status "open"
```

Chatwoot signs `{X-Chatwoot-Timestamp}.{raw_body}`, not the body alone, and
sends the digest as `sha256=<hex>`. Binding the timestamp is what makes the
signature non-replayable, so `src/chatwoot/signature.ts` also rejects
requests outside a 5-minute window.

**Host tickets** (the Business support inbox, `CHATWOOT_BUSINESS_INBOX_ID`)
take the same pipeline with a separate agent: `src/host/` has its own prompt
and tools (`get_booking`, `get_payment_status`, `escalate_to_human`), scoped
in SQL to the properties the host can read. The host is identified by the
Chatwoot contact identifier (their business user id, HMAC-verified when the
contact was created). Guest tools never see a host conversation, and the
reverse. Host tickets are only answered while `SUPPORT_CHAT_ENABLED` and
`SUPPORT_ASSISTANT_ENABLED` are both on. An API-channel message from any
other inbox is dropped rather than treated as a guest.

`POST /webhooks/business-support` is a second account webhook with its own
secret. It keeps `support_tickets` current for the business app and
schedules a reply email (10 min later, at most one per ticket per hour, no
message content). See `packages/support/README.md` for the full host-support
setup.

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
- `src/chatwoot/` — re-exports of the shared Chatwoot client and signature
  check in `@openbookings/support` (also used by apps/business)
- `src/host/` — host-ticket agent: prompt, tools, booking queries
- `src/support/` — business-support webhook and reply-email task
- `src/tasks.ts` — task queue (Cloud Tasks or QStash) + delivery verification

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
MISTRAL_MODEL                       # e.g. mistral-small-2603
CHATWOOT_BASE_URL
CHATWOOT_ACCOUNT_ID
CHATWOOT_BOT_ACCESS_TOKEN           # Settings → Bots → your bot → Access token
CHATWOOT_BOT_WEBHOOK_SECRET         # Settings → Bots → your bot → Webhook secret
SERVICE_BASE_URL                    # public URL of this service (task target, OIDC audience)
REFUND_ESCALATION_THRESHOLD_EUR     # optional, default 250
TASKS_AUTH_DISABLED=true            # local dev only: skip task auth on /tasks/*

TASK_QUEUE=cloud-tasks              # default; or "qstash"
# cloud-tasks:
GOOGLE_CLOUD_PROJECT
CLOUD_TASKS_QUEUE_NAME
CLOUD_TASKS_QUEUE_LOCATION
CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL   # SA the queue mints OIDC tokens for
# qstash:
QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY
QSTASH_NEXT_SIGNING_KEY
QSTASH_URL                          # optional, for a non-default region

# host support (only while SUPPORT_CHAT_ENABLED=true):
SUPPORT_CHAT_ENABLED
SUPPORT_ASSISTANT_ENABLED           # the assistant answers host tickets
CHATWOOT_BUSINESS_INBOX_ID          # numeric id of the Business support inbox (/inboxes/<id>)
CHATWOOT_ACCOUNT_WEBHOOK_SECRET     # Settings → Integrations → Webhooks → business-support entry
BUSINESS_APP_URL                    # links in reply emails
LETTERMINT_PROJECT_TOKEN            # read by @openbookings/mailing
```

`CHATWOOT_BOT_ACCESS_TOKEN` must be the **Agent Bot's** access token, never a
person's (Profile → Access token), so its replies reach Chatwoot (and the
business panel) as `agent_bot`. `CHATWOOT_BOT_WEBHOOK_SECRET` is the secret
Chatwoot signs the Agent Bot's webhook (`/webhooks/chatwoot`) with. The full
name → Chatwoot screen map is in `packages/support/README.md`.

`DATABASE_URL` and `STRIPE_SECRET_KEY` are read inside `@openbookings/db` and
`@openbookings/stripe` — no separate copies here, but they are still required.

Everything the current configuration needs (the chosen queue's credentials,
and the host-support set while it is on) is asserted at startup
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

`send-webhook.ts` signs with `CHATWOOT_BOT_WEBHOOK_SECRET` exactly as Chatwoot
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

The image is built and pushed by the `build-support` job in
`.github/workflows/docker-image.yml`, from `apps/support-bot/Dockerfile` (same
turbo-prune shape as web/business). Runtime config — both the non-secret env
vars and the secrets — is set on the deployment target, not at build time, so
secrets never appear in build logs.

`SERVICE_BASE_URL` is both the Cloud Tasks target and the OIDC audience, so
it must equal the service's own public URL. That URL does not exist until the
first deploy — deploy once, then set the variable and redeploy.

```sh
docker build -f apps/support-bot/Dockerfile -t support-bot .   # from repo root
```
