/**
 * Pushes a newly-sent message to the recipient's Durable Object
 * (ob-durableobjects), replacing the old `pg_notify` call. Service-to-service
 * auth: a static shared secret, distinct from the per-connection user token
 * minted in ./token.ts, since this call originates server-to-server and
 * never touches a browser.
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
