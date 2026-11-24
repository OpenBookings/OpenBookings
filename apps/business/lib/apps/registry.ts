import type { InstallationRegistration } from "@openbookings/apps-contract";

/**
 * Tell an app that an installation exists (or no longer does). The app keeps
 * the installation's key and coordinates; the host's connect and disconnect
 * flows call these. Both throw when the app refuses or is unreachable, so the
 * caller can tell the host instead of leaving them half connected.
 */

function appUrl(): string {
  const url = process.env.APP_SITEMINDER_URL;
  if (!url) throw new Error("APP_SITEMINDER_URL is not set");
  return url.replace(/\/+$/, "");
}

function authorization(): string {
  const secret = process.env.APP_SITEMINDER_REGISTRATION_SECRET;
  if (!secret) throw new Error("APP_SITEMINDER_REGISTRATION_SECRET is not set");
  return `Bearer ${secret}`;
}

async function expectOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`${what} failed: ${res.status} ${body.slice(0, 200)}`);
}

export async function registerInstallation(
  r: InstallationRegistration,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${appUrl()}/installations`, {
    method: "POST",
    headers: { Authorization: authorization(), "Content-Type": "application/json" },
    body: JSON.stringify(r),
  });
  await expectOk(res, "Installation registration");
}

export async function unregisterInstallation(installationId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${appUrl()}/installations/${encodeURIComponent(installationId)}`, {
    method: "DELETE",
    headers: { Authorization: authorization() },
  });
  await expectOk(res, "Installation removal");
}
