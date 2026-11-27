import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

// The route's collaborators are mocked: this test is about the wiring (the
// secret, the injected check, and refreshing the pages the sweep changed).
const refreshed: string[][] = [];
const checkedTexts: string[] = [];
const noticed: unknown[] = [];
const captured: Array<{ error: unknown; hint: unknown }> = [];

class NeedsAPerson extends Error {}

await mockModules(import.meta.dir, {
  "@sentry/nextjs": () => ({
    captureException: (error: unknown, hint: unknown) => {
      captured.push({ error, hint });
    },
  }),
  "@openbookings/db": () => ({ getPool: () => ({}) }),
  "@openbookings/db/reviews": () => ({
    NeedsAPerson,
    runModerationSweep: async (deps: {
      check: (text: string) => Promise<unknown>;
      notify: (items: unknown[]) => Promise<void>;
      onError: (error: unknown, item: { kind: string; id: string }) => void;
    }) => {
      await deps.check("Fine.");
      await deps.notify([{ kind: "review", id: "r1" }]);
      deps.onError(new NeedsAPerson("held item past deadline needs a person"), { kind: "reply", id: "rr1" });
      return { rechecked: 1, published: 2, waiting: 1, purged: { reports: 0, texts: 0 }, propertyIds: ["property-1"] };
    },
  }),
  "@openbookings/moderation": () => ({
    checkText: async (text: string) => {
      checkedTexts.push(text);
      return { verdict: "clean", rules: [], fragments: [], source: "mistral" };
    },
  }),
  "@openbookings/mailing/review-send": () => ({
    sendMaskedPublicationNotices: async (items: unknown[]) => {
      noticed.push(items);
    },
  }),
  "@/lib/property-reviews": () => ({
    refreshPropertyReviewPages: async (ids: string[]) => {
      refreshed.push(ids);
    },
  }),
});

const { POST } = await import("./route");

const call = (authorization?: string) =>
  POST(new Request("http://localhost/api/cron/review-moderation", { method: "POST", headers: authorization ? { authorization } : {} }));

const cronSecret = process.env.CRON_SECRET;
afterAll(() => {
  if (cronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = cronSecret;
});

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  refreshed.length = 0;
  checkedTexts.length = 0;
  noticed.length = 0;
  captured.length = 0;
});

describe("POST /api/cron/review-moderation", () => {
  it("refuses a request without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(refreshed).toEqual([]);
  });

  it("runs the sweep with the moderation check and refreshes the pages it changed", async () => {
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rechecked: 1, published: 2, waiting: 1, purged: { reports: 0, texts: 0 } });
    expect(checkedTexts).toEqual(["Fine."]);
    expect(refreshed).toEqual([["property-1"]]);
    expect(noticed).toEqual([[{ kind: "review", id: "r1" }]]);
  });

  it("raises a held item past the deadline that needs a person as a warning, with its kind and id only", async () => {
    await call("Bearer cron-secret");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.error).toBeInstanceOf(NeedsAPerson);
    expect(captured[0]!.hint).toEqual({
      level: "warning",
      tags: { area: "review-moderation", phase: "deadline" },
      extra: { kind: "reply", id: "rr1" },
    });
  });
});
