import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { redactDeep, redactUrl, sentryRedaction } from "./redact";

// Same shape as createReviewToken: 32 random bytes, base64url, 43 characters.
// Built from repeats so secret scanners don't mistake it for a real credential.
const TOKEN = `${"a".repeat(20)}_-${"B".repeat(21)}`;
const ORIGIN = "https://openbookings.co";

describe("redactUrl", () => {
  test("the sample token has the real token's format", () => {
    expect(randomBytes(32).toString("base64url")).toHaveLength(TOKEN.length);
  });

  test("a review link loses its token", () => {
    expect(redactUrl(`${ORIGIN}/review/${TOKEN}`)).toBe(`${ORIGIN}/review/[token]`);
  });

  test("the opt-out link keeps its /stop suffix", () => {
    expect(redactUrl(`${ORIGIN}/review/${TOKEN}/stop`)).toBe(`${ORIGIN}/review/[token]/stop`);
  });

  test("query strings and fragments survive", () => {
    expect(redactUrl(`${ORIGIN}/review/${TOKEN}?_rsc=1x2y#form`)).toBe(`${ORIGIN}/review/[token]?_rsc=1x2y#form`);
  });

  test("paths without an origin and percent-encoded paths are covered", () => {
    expect(redactUrl(`/review/${TOKEN}`)).toBe("/review/[token]");
    expect(redactUrl(`/login?callbackURL=%2Freview%2F${TOKEN}%2Fstop`)).toBe("/login?callbackURL=%2Freview%2F[token]%2Fstop");
  });

  test("every occurrence in a string is replaced", () => {
    expect(redactUrl(`GET /review/${TOKEN} from ${ORIGIN}/review/${TOKEN}/stop`)).toBe(
      `GET /review/[token] from ${ORIGIN}/review/[token]/stop`,
    );
  });

  test("other URLs and route patterns are left alone", () => {
    for (const url of [
      `${ORIGIN}/bookings/OB-12345/review`,
      `${ORIGIN}/p/hotel-x/reviews/abc`,
      "/review/[token]",
      "/review/[token]/stop",
      `${ORIGIN}/`,
    ]) {
      expect(redactUrl(url)).toBe(url);
    }
  });
});

describe("redactUrl: sign-in link tokens", () => {
  test("the magic-link verify URL and the confirm pages lose their token", () => {
    expect(redactUrl(`${ORIGIN}/api/auth/magic-link/verify?token=${TOKEN}&callbackURL=%2Faccount`)).toBe(
      `${ORIGIN}/api/auth/magic-link/verify?token=[token]&callbackURL=%2Faccount`,
    );
    expect(redactUrl(`${ORIGIN}/auth/confirm?callbackURL=%2Faccount&token=${TOKEN}`)).toBe(
      `${ORIGIN}/auth/confirm?callbackURL=%2Faccount&token=[token]`,
    );
    expect(redactUrl(`/login/confirm?token=${TOKEN}#x`)).toBe("/login/confirm?token=[token]#x");
  });

  test("a token nested in an encoded callback is covered too", () => {
    expect(redactUrl(`/x?next=%2Fauth%2Fconfirm%3Ftoken%3D${TOKEN}%26a%3D1`)).toBe(
      "/x?next=%2Fauth%2Fconfirm%3Ftoken%3D[token]%26a%3D1",
    );
  });

  test("other parameters are left alone", () => {
    for (const url of [`${ORIGIN}/search?tokens=2`, `${ORIGIN}/x?mytoken=abc`, `${ORIGIN}/x?token=`]) {
      expect(redactUrl(url)).toBe(url);
    }
  });
});

describe("redactDeep", () => {
  test("a PostHog $pageview carries no token in any URL property", () => {
    const event = {
      uuid: "0193-uuid",
      event: "$pageview",
      properties: {
        $current_url: `${ORIGIN}/review/${TOKEN}`,
        $pathname: `/review/${TOKEN}`,
        $referrer: `${ORIGIN}/review/${TOKEN}/stop`,
        $prev_pageview_pathname: `/review/${TOKEN}`,
        $host: "openbookings.co",
        release: "abc123",
      },
      $set_once: { $initial_current_url: `${ORIGIN}/review/${TOKEN}`, $initial_pathname: `/review/${TOKEN}` },
      $set: { $current_url: `${ORIGIN}/review/${TOKEN}` },
      timestamp: new Date("2026-11-22T10:00:00Z"),
    };
    const out = redactDeep(event);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(out.properties.$current_url).toBe(`${ORIGIN}/review/[token]`);
    expect(out.properties.$referrer).toBe(`${ORIGIN}/review/[token]/stop`);
    expect(out.$set_once.$initial_pathname).toBe("/review/[token]");
    expect(out.properties.$host).toBe("openbookings.co");
    expect(out.timestamp).toBeInstanceOf(Date);
  });

  test("a session-replay snapshot has the token stripped from its meta href", () => {
    const event = {
      uuid: "u",
      event: "$snapshot",
      properties: { $snapshot_data: [{ type: 4, data: { href: `${ORIGIN}/review/${TOKEN}`, width: 1, height: 1 } }] },
    };
    expect(JSON.stringify(redactDeep(event))).not.toContain(TOKEN);
  });

  test("a Sentry error event loses the token from request, transaction, breadcrumbs and contexts", () => {
    const event = {
      event_id: "e1",
      type: undefined,
      transaction: `/review/${TOKEN}`,
      request: { url: `${ORIGIN}/review/${TOKEN}`, headers: { Referer: `${ORIGIN}/review/${TOKEN}` } },
      breadcrumbs: [
        { category: "navigation", data: { from: `/review/${TOKEN}`, to: "/bookings/OB-1/review" } },
        { category: "fetch", data: { url: `/review/${TOKEN}?_rsc=abc`, method: "GET", status_code: 200 } },
      ],
      contexts: { trace: { data: { "url.full": `${ORIGIN}/review/${TOKEN}` } } },
      exception: { values: [{ type: "Error", value: `failed at /review/${TOKEN}` }] },
    };
    const out = sentryRedaction.beforeSend(event);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(out.request.url).toBe(`${ORIGIN}/review/[token]`);
    expect(out.breadcrumbs[0]!.data.from).toBe("/review/[token]");
    expect(out.breadcrumbs[1]!.data.url).toBe("/review/[token]?_rsc=abc");
    expect(out.breadcrumbs[1]!.data.status_code).toBe(200);
  });

  test("a streamed Sentry span and a breadcrumb are redacted through the same hooks", () => {
    const span = {
      trace_id: "t",
      span_id: "s",
      name: `GET /review/${TOKEN}`,
      start_timestamp: 1,
      status: "ok" as const,
      is_segment: true,
      attributes: { "url.full": `${ORIGIN}/review/${TOKEN}/stop`, "http.request.method": "GET" },
    };
    expect(JSON.stringify(sentryRedaction.beforeSendSpan(span))).not.toContain(TOKEN);
    const crumb = { category: "navigation", data: { from: "/", to: `/review/${TOKEN}` } };
    expect(sentryRedaction.beforeBreadcrumb(crumb).data.to).toBe("/review/[token]");
  });

  test("cycles and non-plain objects do not trip it up", () => {
    const a: Record<string, unknown> = { url: `/review/${TOKEN}` };
    a.self = a;
    const scope = new (class Scope {
      secret = `/review/${TOKEN}`;
    })();
    const out = redactDeep({ a, sdkProcessingMetadata: { scope } });
    expect(out.a.url).toBe("/review/[token]");
    expect(redactDeep(`/review/${TOKEN}`)).toBe("/review/[token]");
    expect(redactDeep(null)).toBeNull();
    expect(redactDeep(42)).toBe(42);
  });
});
