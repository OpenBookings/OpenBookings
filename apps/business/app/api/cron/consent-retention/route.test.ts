import { beforeEach, describe, expect, test } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

type Call = { text: string; values: unknown[] };
const calls: Call[] = [];

await mockModules(import.meta.dir, {
  "@openbookings/db": () => ({
    query: async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return [{ id: "c1" }, { id: "c2" }];
    },
  }),
});

const { POST } = await import("./route");

const cron = (headers: Record<string, string> = { authorization: "Bearer test-cron-secret" }) =>
  new Request("http://localhost/api/cron/consent-retention", { method: "POST", headers });

describe("consent retention", () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.CRON_SECRET = "test-cron-secret";
  });

  test("deletes consent records older than 5 years, and nothing else", async () => {
    const res = await POST(cron());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deletedConsentRecords: 2, retentionYears: 5 });
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(text).toMatch(/^\s*DELETE FROM consent_log\s/);
    expect(text).toMatch(/created_at < NOW\(\) - make_interval\(years => \$1\)/);
    expect(values).toEqual([5]);
  });

  test("requires the cron secret", async () => {
    expect((await POST(cron({}))).status).toBe(401);
    expect((await POST(cron({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
