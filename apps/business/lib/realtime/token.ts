import { createHmac } from "crypto";

// Short-lived: minted right before the client opens (or reopens) the
// WebSocket, not held onto or reused across reconnects — the client
// re-requests a fresh token per connection attempt.
const TOKEN_TTL_MS = 60_000;

function getSecret(): string {
  const secret = process.env.REALTIME_TOKEN_SECRET;
  if (!secret) throw new Error("REALTIME_TOKEN_SECRET is not set");
  return secret;
}

/**
 * Signs a token the ob-durableobjects Worker verifies before upgrading a
 * WebSocket connection to a user's Durable Object. Shape:
 * `${userId}.${expiresAtMs}.${signature}`, matching the verifier in
 * ob-durableobjects/src/index.ts.
 */
export function mintRealtimeToken(userId: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  const signature = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt };
}
