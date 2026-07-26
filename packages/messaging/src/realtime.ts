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

/**
 * Pushes a newly-sent message to the recipient's Durable Object
 * (ob-durableobjects), replacing the old `pg_notify` call. Service-to-service
 * auth: a static shared secret, distinct from the per-connection user token
 * minted above, since this call originates server-to-server and never
 * touches a browser.
 *
 * Best-effort: the message is already durably stored by the time this runs,
 * so a delivery failure here is logged, not thrown — the client's polling
 * fallback covers it either way.
 */
export async function deliverMessageToRecipient(params: {
  recipientId: string;
  threadId: string;
  message: unknown;
}): Promise<void> {
  const workerUrl = process.env.REALTIME_WORKER_URL;
  const secret = process.env.REALTIME_SERVICE_SECRET;
  if (!workerUrl || !secret) {
    console.error("Realtime delivery skipped: REALTIME_WORKER_URL/REALTIME_SERVICE_SECRET not configured");
    return;
  }

  try {
    const res = await fetch(`${workerUrl}/deliver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      console.error(`Realtime delivery failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("Realtime delivery request failed", err);
  }
}
