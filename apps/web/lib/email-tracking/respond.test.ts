import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as nextServer from "next/server";
import { sealToken } from "@openbookings/mailing/tracking";
import { mockModules } from "@/lib/mock-modules";
import { clickResponse, openResponse, type Schedule } from "./respond";

// The routes schedule capture with Next's `after`; recording it shows whether a capture was scheduled.
const after = mock((_task: () => Promise<void>) => {});
await mockModules(import.meta.dir, { "next/server": () => ({ ...nextServer, after }) });

function recorder() {
  const tasks: Array<() => Promise<void>> = [];
  const schedule: Schedule = (t) => void tasks.push(t);
  return { tasks, schedule };
}

let warnSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe("email tracking responses with a bad token", () => {
  it("open returns the gif with no-store and schedules the handler", async () => {
    const r = recorder();
    const res = openResponse("garbage", null, r.schedule);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await res.arrayBuffer()).byteLength).toBe(42);
    expect(r.tasks).toHaveLength(1);
    await r.tasks[0]!();
  });

  it("click redirects to the web home and schedules the handler", async () => {
    const r = recorder();
    const res = clickResponse("garbage", "UA", r.schedule);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^https?:\/\/[^/]+\/?$/);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(r.tasks).toHaveLength(1);
    await r.tasks[0]!();
  });
});

const key = Buffer.alloc(32, 9);
const ENV_NAMES = [
  "EMAIL_TRACKING_ENABLED",
  "EMAIL_TRACKING_SECRET",
  "EMAIL_TRACKING_CONSENT_VERSION",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_WEB_URL",
  "NEXT_PUBLIC_BUSINESS_URL",
] as const;

/** Mail sent while tracking was on; tracking is now off, only the secret and urls remain. */
function withTrackingDisabled() {
  const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  beforeEach(() => {
    for (const n of ENV_NAMES) delete process.env[n];
    process.env.EMAIL_TRACKING_SECRET = key.toString("base64");
    process.env.NEXT_PUBLIC_WEB_URL = "https://web.example.test";
    process.env.NEXT_PUBLIC_BUSINESS_URL = "https://business.example.test";
  });
  afterEach(() => {
    for (const n of ENV_NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });
}

const sealed = (d: string) =>
  sealToken({ v: 1, s: "send-1", k: "booking_new_host", u: "user-1", t: 1_800_000_000, l: "cta", d }, key);

describe("click redirect with tracking disabled after send", () => {
  withTrackingDisabled();

  it("still redirects a valid token to its own-host destination", () => {
    const res = clickResponse(sealed("https://business.example.test/stays?a=1&b=2"), null, recorder().schedule);
    expect(res.headers.get("location")).toBe("https://business.example.test/stays?a=1&b=2");
  });

  it("goes to the web home when the secret is missing", () => {
    delete process.env.EMAIL_TRACKING_SECRET;
    const res = clickResponse(sealed("https://business.example.test/stays"), null, recorder().schedule);
    expect(res.headers.get("location")).toBe("https://web.example.test/");
  });
});

describe("HEAD requests", () => {
  withTrackingDisabled();
  beforeEach(() => after.mockClear());

  const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

  it("open answers HEAD with the same gif and schedules no capture", async () => {
    const { GET, HEAD } = await import("@/app/e/o/[token]/route");
    const head = await HEAD(new Request("https://web.example.test/e/o/t", { method: "HEAD" }), ctx("t"));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("image/gif");
    expect(head.headers.get("cache-control")).toContain("no-store");
    expect(after).not.toHaveBeenCalled();
    await GET(new Request("https://web.example.test/e/o/t"), ctx("t"));
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("click answers HEAD with the same redirect and schedules no capture", async () => {
    const { GET, HEAD } = await import("@/app/e/c/[token]/route");
    const token = sealed("https://business.example.test/stays");
    const head = await HEAD(new Request(`https://web.example.test/e/c/${token}`, { method: "HEAD" }), ctx(token));
    expect(head.status).toBe(302);
    expect(head.headers.get("location")).toBe("https://business.example.test/stays");
    expect(after).not.toHaveBeenCalled();
    await GET(new Request(`https://web.example.test/e/c/${token}`), ctx(token));
    expect(after).toHaveBeenCalledTimes(1);
  });
});
