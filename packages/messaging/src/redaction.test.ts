import { beforeEach, describe, expect, mock, test } from "bun:test";
import { REDACTED_MESSAGE_BODY } from "./redaction";

type Call = { text: string; values: unknown[] };
const calls: Call[] = [];

mock.module("@openbookings/db", () => ({
  query: async (text: string, values: unknown[]) => {
    calls.push({ text, values });
    return [{ id: "m1" }, { id: "m2" }];
  },
  queryOne: async () => null,
}));

const { createMessagingRoutes } = await import("./routes");

const routes = createMessagingRoutes({ getSession: async () => null } as never);
const cron = () =>
  new Request("http://localhost/api/cron/messaging-retention", {
    method: "POST",
    headers: { authorization: "Bearer test-cron-secret" },
  });

describe("retention sweep", () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.CRON_SECRET = "test-cron-secret";
    delete process.env.MESSAGE_RETENTION_DAYS;
  });

  test("decides 'already redacted' by the body, so deleted guests' messages are not skipped", async () => {
    const res = await routes.runRetention(cron());
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    // A deleted guest's messages have sender_id NULL; keying on
    // `sender_id IS NOT NULL` skipped them (and their text) forever.
    expect(text).not.toMatch(/sender_id\s+IS\s+NOT\s+NULL/i);
    expect(text).toMatch(/m\.body\s*<>\s*\$2::text/);
    expect(text).toMatch(/SET sender_id = NULL, body = \$2::text/);
    expect(values[1]).toBe(REDACTED_MESSAGE_BODY);
  });

  test("still requires the cron secret", async () => {
    const res = await routes.runRetention(new Request("http://localhost/x", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
