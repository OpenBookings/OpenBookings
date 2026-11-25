/**
 * Tell an app (via QStash) that its installation has new work. The app answers
 * on `${appBaseUrl}/doorbell` and pulls from the Apps API. Gives up after
 * DOORBELL_TIMEOUT_MS: a slow QStash must not hold up the booking that rang.
 */
const DOORBELL_TIMEOUT_MS = 5_000;

export async function ringDoorbell(
  i: { qstashUrl: string; qstashToken: string; appBaseUrl: string; installationId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${i.qstashUrl}/v2/publish/${i.appBaseUrl}/doorbell`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${i.qstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ installationId: i.installationId }),
    signal: AbortSignal.timeout(DOORBELL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Doorbell publish failed: ${res.status} ${body.slice(0, 200)}`);
  }
}
