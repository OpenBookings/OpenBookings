import type { ConsentEvent } from "./consent-events";
import { consentEventSchema } from "./consent-schema";

export type ConsentEventRow = ConsentEvent & {
  app: "web" | "business";
  userId: string | null;
};

type ConsentHandlerDeps = {
  app: "web" | "business";
  /** Appends the event; a repeated idempotency key must return the first result. */
  insert: (row: ConsentEventRow) => Promise<{ expiresAt: string }>;
  /** The signed-in user for this request, from the server session only. */
  getUserId: () => Promise<string | null>;
};

const MAX_BODY_BYTES = 2048;

function reply(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * `POST /api/consent` — records one consent event as evidence.
 *
 * Public by necessity: most visitors deciding about cookies are not signed in.
 * What keeps it safe is that it accepts almost nothing — a strict schema, a
 * 2 KB body, same-origin only — and stores no IP address or user agent.
 *
 * Rate limiting is NOT done here. It is a Cloudflare rate limiting rule on
 * this path (configured in the Cloudflare dashboard, not in this repo), so the
 * visitor's IP is never handled by application code. A 429 from that rule is
 * something the client outbox already retries.
 *
 * Nothing about the request is logged.
 */
export function createConsentHandler(deps: ConsentHandlerDeps) {
  return async function handleConsent(req: Request): Promise<Response> {
    // Browsers send Origin on every POST. A request without one is not a
    // browser, and it gets no more than a browser would: the same schema.
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) {
      return reply({ error: "forbidden" }, 403);
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return reply({ error: "unsupported_media_type" }, 415);
    }

    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return reply({ error: "payload_too_large" }, 413);
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return reply({ error: "invalid_request" }, 400);
    }

    const parsed = consentEventSchema.safeParse(json);
    if (!parsed.success) return reply({ error: "invalid_request" }, 400);
    const event = parsed.data;

    try {
      // Only ever from the session. The schema has no field for it, so a
      // caller cannot attach a decision to someone else's account.
      const userId = await deps.getUserId();
      if (event.eventType === "linked" && !userId) {
        return reply({ error: "unauthorized" }, 401);
      }

      const { expiresAt } = await deps.insert({ ...event, app: deps.app, userId });
      return reply({ ok: true, expiresAt }, 200);
    } catch {
      return reply({ error: "server_error" }, 500);
    }
  };
}
