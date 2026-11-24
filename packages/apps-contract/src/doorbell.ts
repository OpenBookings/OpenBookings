/**
 * Tell an app (via QStash) that its installation has new work. The app answers
 * on `${appBaseUrl}/doorbell` and pulls from the Apps API.
 */
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
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Doorbell publish failed: ${res.status} ${body.slice(0, 200)}`);
  }
}
