import { describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";

const sentTo: string[] = [];

mock.module("@/lib/auth", () => ({
  auth: {
    api: {
      signInMagicLink: async ({ body }: { body: { email: string } }) => {
        sentTo.push(body.email);
      },
    },
  },
}));
mock.module("@openbookings/db", () => ({ queryOne: async () => null }));
mock.module("@openbookings/analytics/server", () => ({
  getPostHogClient: () => ({ capture: () => {}, shutdown: async () => {} }),
}));

const { POST } = await import("./route");

function post(email: string, ip: string) {
  return POST(
    new NextRequest("http://localhost/api/auth/login-link", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ email }),
    }),
  );
}

describe("login-link rate limits", () => {
  it("requests refused by the IP limit do not use up another address's link budget", async () => {
    const attackerIp = "198.51.100.7";
    for (let i = 0; i < 5; i++) {
      expect((await post(`attacker+${i}@example.test`, attackerIp)).status).toBe(200);
    }
    for (let i = 0; i < 3; i++) {
      expect((await post("victim@example.test", attackerIp)).status).toBe(429);
    }

    const res = await post("victim@example.test", "203.0.113.50");
    expect(res.status).toBe(200);
    expect(sentTo).toContain("victim@example.test");
  });
});
