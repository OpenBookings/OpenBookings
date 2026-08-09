/**
 * Tirreno feed (task 17): forwards host-portal auth events to a Tirreno
 * instance's sensor endpoint. Entirely env-gated — without TIRRENO_URL and
 * TIRRENO_API_KEY this is a no-op, so dev and CI never need the service.
 * Failures are swallowed by the caller (risk tooling never blocks auth).
 */
export async function forwardAuthEvent(event: {
  action: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  newDevice?: boolean;
}): Promise<void> {
  const url = process.env.TIRRENO_URL;
  const apiKey = process.env.TIRRENO_API_KEY;
  if (!url || !apiKey) return;

  await fetch(`${url.replace(/\/$/, "")}/sensor/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Api-Key": apiKey,
    },
    body: new URLSearchParams({
      userName: event.userId,
      eventTime: new Date().toISOString(),
      ipAddress: event.ip ?? "",
      userAgent: event.userAgent ?? "",
      url: "/auth/" + event.action,
      eventType: event.action,
    }),
    signal: AbortSignal.timeout(5000),
  });
}
