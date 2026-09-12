# Turnstile on checkout

Cloudflare Turnstile gates `POST /api/checkout` — the route that creates the
Stripe Checkout Session. That route is unauthenticated and every call reaches
Stripe's API, so without a gate anyone can drive Session creation in a loop.

Widget: **already created**, sitekey `0x4AAAAAACgQ1RzP_I4Cne2S`. Do not create a
replacement — the sitekey below and the secret in your env must belong to the
same widget.

## How it fits together

```
browser ──token──> POST /api/checkout ──siteverify──> Cloudflare
                          │
                          └── verified? ──> existing Stripe logic, unchanged
```

The browser never calls siteverify itself; a widget that renders proves
nothing on its own. `apps/web/app/checkout/_lib/turnstile.ts` does the exchange
server-side and requires all three of:

| Check | Why |
| --- | --- |
| `success === true` | Challenge solved, and the token has not been redeemed before. Tokens are single-use, so a replay fails here. |
| `action === "checkout"` | A token minted by any other widget on this sitekey cannot be spent against checkout. |
| `hostname` in `TURNSTILE_HOSTNAMES` | One widget serves local and production domains, so without this a token solved on localhost would be spendable against production. |

Verification fails closed: a missing secret, an empty allowlist, a timeout or a
Cloudflare outage all block checkout rather than opening it. The guest sees a
retryable message and never a reason.

## Environment variables

| Variable | Where | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | client | `0x4AAAAAACgQ1RzP_I4Cne2S` (public; falls back to this if unset) |
| `TURNSTILE_SECRET` | server | The widget's secret. Never commit it. |
| `TURNSTILE_HOSTNAMES` | server | Comma-separated frontend hostnames whose tokens this deployment accepts. |

`TURNSTILE_HOSTNAMES` is **deployment-specific**:

```
# local
TURNSTILE_HOSTNAMES=localhost,127.0.0.1

# production — must NOT contain localhost or 127.0.0.1
TURNSTILE_HOSTNAMES=openbookings.co
```

Registering `localhost` on the widget is what lets the local dev server render
it. Putting `localhost` in a *production* allowlist is what would let a token
solved on a laptop be spent against production, so keep the two lists apart.

## Remaining setup

The secret was not retrieved or written by the integration change — the
environment had no Wrangler, no `gcloud`, and no Cloudflare credentials, and the
secret must never pass through chat. Finish it yourself:

1. **Local.** Add `TURNSTILE_SECRET` and `TURNSTILE_HOSTNAMES` to `.env.local`
   (already covered by `.gitignore`).
2. **Production.** Add the secret to the same store the other secrets use —
   Google Secret Manager, alongside `stripe-secret-key` — and surface it to the
   `web` service the way `cloudbuild.yaml` surfaces the rest. Pipe it through
   stdin rather than passing it as a command argument:

   ```sh
   printf '%s' "$SECRET" | gcloud secrets create turnstile-secret --data-file=-
   ```

   To pull the secret without printing it, Wrangler 4.109+ can read it straight
   from the widget:

   ```sh
   WRANGLER_WRITE_LOGS=false WRANGLER_LOG=log WRANGLER_LOG_SANITIZE=true \
     wrangler turnstile widget get 0x4AAAAAACgQ1RzP_I4Cne2S --json
   ```

3. **Confirm the widget's domains** include every hostname you listed, plus
   `localhost` and `127.0.0.1` for development.

## Validating it works

Not yet validated end to end — see above. Once the secret is in place, with the
app running:

1. Load `/checkout`. The widget resolves (usually without interaction) and the
   payment form appears. That is one successful verified request.
2. Replay it: take the `cf-turnstile-response` value from that request and POST
   it a second time. It must come back **403** — tokens are single-use, and a
   second siteverify on the same token returns `success: false`.

   ```sh
   curl -i -X POST http://localhost:3002/api/checkout \
     -H 'Content-Type: application/json' \
     -d '{"cf-turnstile-response":"<token from step 1>"}'
   ```

Both must pass. A 403 in step 1 usually means `TURNSTILE_SECRET` never reached
the server (`invalid-input-secret`) or the hostname allowlist does not contain
the host you loaded the page on.
