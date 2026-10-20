# @openbookings/support

Host support for `apps/business`: every ticket is one Chatwoot conversation in
a dedicated **API-channel inbox** ("Business support"). This package is the
Chatwoot plumbing shared by the business app and the support bot. It's
server-only, because it reads tokens from the environment.

| Where | What it does |
| --- | --- |
| `packages/support` | Client API (contact side), Application API (agent side), the one hand-off function, webhook signature check |
| `packages/db` → `support-tickets.ts`, migration `0025_business_support.sql` | `support_contacts`, `support_tickets`, `support_ticket_reads` and the writes by conversation id |
| `apps/business` → `lib/support/*`, `components/support/*`, `/support` | Panel, ticket list, server actions, upload routes, org-scoped reads |
| `apps/support-bot` → `src/host/*`, `src/support/*` | Host assistant (own prompt and tools), the support webhook, reply emails |

Guest support is not involved and is unchanged: guests keep the website-widget inbox and the guest tools.

## Switches

Both default to **off**. With both off nothing ships: the sidebar's Support item is a plain link, `/support` shows "Coming soon", and the bot ignores the business inbox.

| Variable | Where | Effect |
| --- | --- | --- |
| `SUPPORT_CHAT_ENABLED` | business, bot | Panel, `/support` ticket list, help entry, the business-support webhook and reply emails |
| `SUPPORT_ASSISTANT_ENABLED` | business, bot | The AI assistant answers host tickets; the panel shows the orb, "Talk to a person" and "Did this answer your question?". Off: tickets go straight to the support team (`open`) and the bot ignores them |

Turn on `SUPPORT_CHAT_ENABLED` first. Only turn on `SUPPORT_ASSISTANT_ENABLED` once the bot's task queue works (see step 6). Without a working queue the assistant never answers, and every ticket waits 30 seconds before it offers a person.

## Verified against Chatwoot 4.18 (local, 19 Oct 2026)

- **Identity validation.** Contact creation needs a valid `identifier_hash`. A wrong or missing hash is refused (Chatwoot answers 500, not 401), and so is an attempt to take over another user's identifier.
- **Custom attributes.** The public create-conversation call stores `custom_attributes` but doesn't return them. The Application API's `custom_attributes` call **replaces** the whole set unless sent with `merge: true`; our helper always merges.
- **Agent Bot tokens** may only call: conversation show/create/update/toggle_status/toggle_typing_status/custom_attributes, message create, assignments and labels. They **can't list messages**, so the bot starts from the current message when it has no cached history.
- **Attachments.** Multipart `attachments[]` works on the public create-message call.
- **Starting status.** New conversations start as **`open`** until an Agent Bot is attached to the inbox. Attach it (step 2), or the bot never sees a `pending` ticket.
- **Resolved tickets.** A message posted after resolve is accepted and **reopens** the conversation, even with "allow messages after resolved" unset. The business server checks Chatwoot's status before every send and refuses resolved tickets.
- **Websocket.** `wss://…/cable`, `RoomChannel` with the contact's `pubsub_token`. You get `message.created`, `conversation.status_changed`, `conversation.updated` and `presence.update`. The ids are conversation display ids.
- **⚠ Websocket payloads contain the contact's `source_id`** (inside `contact_inbox` on `conversation.status_changed`). So the browser sees the credential for its own conversations, even though our server never sends it. It only grants access to that same user's own conversations, but it lets them use the Client API directly and skip our checks (for example to reopen a resolved ticket). The backfill webhook re-checks org membership for exactly this reason. Removing the exposure completely would need a websocket relay of our own.

Verified with the Agent Bot token: hand-off (private note + `open`), typing on/off, status changes and custom attributes. Still to see with a live bot reply: that it arrives with `sender.type = "agent_bot"`, plus the agent-side typing events on the websocket.

## Setup

### 1. Database

Apply `packages/db/drizzle/0025_business_support.sql`. CI does this on merge (`db:migrate:ci`); by hand it's `psql "$DATABASE_URL_DIRECT" -f packages/db/drizzle/0025_business_support.sql`. It's idempotent and only adds tables.

### 2. Chatwoot inbox

In Chatwoot → Settings → Inboxes:

1. Use the existing API inbox (or create one called "Business support", channel **API**, webhook URL empty).
2. **Configuration → Identity validation:** on, and enforced. Copy its HMAC token → `CHATWOOT_BUSINESS_INBOX_HMAC_TOKEN`.
3. Note two values: the **inbox identifier** (the long text token under Configuration) → `CHATWOOT_BUSINESS_INBOX_IDENTIFIER`, and the **numeric inbox id** (in the settings URL, `/inboxes/<id>`) → `CHATWOOT_BUSINESS_INBOX_ID` (bot only).
4. **Settings:** "Lock to single conversation" **off**, "Allow messages after conversation is resolved" **off**.
5. **Business hours:** on, with your hours and timezone. The panel's response line reads them.
6. **Bot configuration:** attach the existing Agent Bot. That's what makes new tickets start `pending` ("With assistant").

### 3. Agent Bot token

The Application API calls (hand-off, custom attributes, typing, the bot's replies) must authenticate as the **Agent Bot**, never as a person. Otherwise the bot's replies show up as written by a person, which breaks the AI labelling (EU AI Act Art. 50).

Settings → Bots → your bot → copy its access token → `CHATWOOT_BOT_ACCESS_TOKEN` (same value in the business app and the bot), and its webhook secret → `CHATWOOT_BOT_WEBHOOK_SECRET` (bot only). Set the bot's outgoing URL to `https://<support-bot>/webhooks/chatwoot`. Don't use a person's token from Profile → Access token here.

### 4. Conversation custom attributes

Settings → Custom attributes → **Conversation**. Create these keys (display names are up to you):

| Key | Type |
| --- | --- |
| `category` | List: `bookings`, `payments`, `availability`, `listing`, `account`, `broken`, `other` |
| `org_id` | Text |
| `property_id` | Text |
| `linked_type` | List: `booking`, `listing` |
| `linked_id` | Text |
| `follow_up_of` | Text |
| `route` | Text |
| `app_version` | Text |
| `replay_url` | Link |

### 5. Webhook

Settings → Integrations → Webhooks → add: URL `https://<support-bot>/webhooks/business-support`, events **Conversation created**, **Conversation status changed** and **Message created**. Copy its secret → `CHATWOOT_ACCOUNT_WEBHOOK_SECRET` (bot). This is separate from the Agent Bot's webhook and its secret.

Chatwoot refuses `localhost` webhook URLs. For local testing run `cloudflared tunnel --url http://localhost:3003` and use the tunnel URL. Without the webhook everything still works, but the list only updates when a chat is opened, and no reply emails go out.

### 6. Task queue (needed for the assistant and reply emails)

Cloud Tasks doesn't exist on Scaleway, so the bot can now use **Upstash QStash** instead:

1. Upstash console → QStash → copy `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`. If the QStash region is EU, also set `QSTASH_URL` to the URL shown there.
2. On the bot: `TASK_QUEUE=qstash` plus those variables. `SERVICE_BASE_URL` must be the bot's public URL: QStash calls `<SERVICE_BASE_URL>/tasks/process-conversation` and `/tasks/support-reply-notify` and signs every call.
3. Locally, `TASKS_INLINE=true` + `TASKS_AUTH_DISABLED=true` still work. Delays then run as in-process timers.

`TASK_QUEUE=cloud-tasks` (the default) keeps the old setup.

### 7. Environment

Each Chatwoot value is named after the screen it comes from:

| Variable | Chatwoot | Used by |
| --- | --- | --- |
| `CHATWOOT_BASE_URL` | Your Chatwoot URL | bot, business |
| `CHATWOOT_ACCOUNT_ID` | `/app/accounts/<id>/…` in the URL | bot, business |
| `CHATWOOT_BOT_ACCESS_TOKEN` | Settings → Bots → your bot → Access token | bot, business |
| `CHATWOOT_BOT_WEBHOOK_SECRET` | Settings → Bots → your bot → Webhook secret | bot |
| `CHATWOOT_BUSINESS_INBOX_ID` | Business support inbox → `/inboxes/<id>` in the URL | bot |
| `CHATWOOT_BUSINESS_INBOX_IDENTIFIER` | Business support inbox → Configuration → Inbox identifier | business |
| `CHATWOOT_BUSINESS_INBOX_HMAC_TOKEN` | Business support inbox → Configuration → Identity validation → HMAC token | business |
| `CHATWOOT_ACCOUNT_WEBHOOK_SECRET` | Settings → Integrations → Webhooks → the `/webhooks/business-support` entry | bot |

**apps/business** (runtime):

```
SUPPORT_CHAT_ENABLED=true
SUPPORT_ASSISTANT_ENABLED=false          # true once step 6 works
CHATWOOT_BASE_URL=https://chat.…          # server → Chatwoot (defaults to the public one)
CHATWOOT_BUSINESS_INBOX_IDENTIFIER=<inbox identifier>
CHATWOOT_BUSINESS_INBOX_HMAC_TOKEN=<inbox HMAC token>
CHATWOOT_BOT_ACCESS_TOKEN=<agent bot access token>
CHATWOOT_ACCOUNT_ID=1
```

**apps/business** (build arg, already wired in CI and the Dockerfile): `NEXT_PUBLIC_CHATWOOT_BASE_URL`, used for the browser's websocket and the CSP. `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` is no longer used; remove the CI variable.

If Chatwoot stores attachments in S3/R2 instead of on its own disk, add that storage host to `img-src` in `apps/business/next.config.ts`, because attachment URLs redirect there.

**apps/support-bot**, on top of what it already has:

```
CHATWOOT_BOT_ACCESS_TOKEN=<agent bot access token>
CHATWOOT_BOT_WEBHOOK_SECRET=<agent bot webhook secret>
SUPPORT_CHAT_ENABLED=true
SUPPORT_ASSISTANT_ENABLED=false
CHATWOOT_BUSINESS_INBOX_ID=<numeric inbox id>
CHATWOOT_ACCOUNT_WEBHOOK_SECRET=<step 5>
BUSINESS_APP_URL=https://business.openbookings.co
LETTERMINT_PROJECT_TOKEN=…
EMAIL_FROM_ADDRESS="OpenBookings Support <noreply@openbookings.co>"   # optional
TASK_QUEUE=qstash
QSTASH_TOKEN=…  QSTASH_CURRENT_SIGNING_KEY=…  QSTASH_NEXT_SIGNING_KEY=…
```

The bot refuses to start when a variable its configuration needs is missing.

### 8. Before launch (from the handoff's risks)

- Get the AI wording in `apps/business/lib/support/copy.ts` checked once (Art. 50).
- Set a retention period for support conversations and attachments in Chatwoot, and mention support in the privacy policy (hosts will paste guest data).
- Pin the Chatwoot version and re-run the checks above after upgrades.

## Proposed numbers (confirm or change)

| What | Value | Where |
| --- | --- | --- |
| Message cap | 2,000 characters | `apps/business/lib/support/categories.ts` |
| Silent assistant → offer a person | 30 s | `apps/business/lib/support/activity.ts` |
| Reply email delay | 10 min | `apps/support-bot/src/support/webhook.ts` |
| Reply emails | at most 1 per ticket per hour | `packages/db/src/support-tickets.ts` |
| Attachments | images and PDF, 5 × 10 MB | `apps/business/lib/support/attachments.ts` |
