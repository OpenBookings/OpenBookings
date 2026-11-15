import { expect, test } from "bun:test";
import { captureServerEvent } from "./server";

const base = { distinctId: "s1", event: "email_opened", properties: { email_kind: "review_invitation" } };

test("captures one anonymous event without a person profile", async () => {
  const calls: any[] = [];
  const client = { captureImmediate: async (m: unknown) => void calls.push(m) };
  await captureServerEvent({ ...base, anonymous: true }, { client });
  expect(calls).toHaveLength(1);
  expect(calls[0].distinctId).toBe("s1");
  expect(calls[0].event).toBe("email_opened");
  expect(calls[0].properties).toEqual({ email_kind: "review_invitation", $process_person_profile: false });
});

test("a named event carries no profile override", async () => {
  const calls: any[] = [];
  await captureServerEvent(base, { client: { captureImmediate: async (m) => void calls.push(m) } });
  expect(calls[0].properties).toEqual({ email_kind: "review_invitation" });
});

test("a rejecting client does not throw", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    await captureServerEvent(base, { client: { captureImmediate: () => Promise.reject(new Error("boom")) } });
  } finally {
    console.error = orig;
  }
});

test("a client that never resolves times out", async () => {
  const start = Date.now();
  await captureServerEvent(base, { client: { captureImmediate: () => new Promise<void>(() => {}) }, timeoutMs: 10 });
  expect(Date.now() - start).toBeLessThan(1000);
});
