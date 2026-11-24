import { describe, expect, test } from "bun:test";
import { ringDoorbell } from "./doorbell";

const input = {
  qstashUrl: "https://qstash.example.com",
  qstashToken: "tok_123",
  appBaseUrl: "https://siteminder.example.com",
  installationId: "inst-1",
};

describe("ringDoorbell", () => {
  test("posts to QStash with bearer token and installation id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;
    await ringDoorbell(input, fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://qstash.example.com/v2/publish/https://siteminder.example.com/doorbell");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok_123");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ installationId: "inst-1" });
  });

  test("throws on a non-2xx response", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(ringDoorbell(input, fetchImpl)).rejects.toThrow(/500/);
  });
});
