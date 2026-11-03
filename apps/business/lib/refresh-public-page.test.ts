import { describe, expect, test } from "bun:test";
import { refreshPublicPropertyPage, type RefreshEnv } from "./refresh-public-page";

const FULL_ENV: RefreshEnv = {
  webUrl: "https://openbookings.co/",
  revalidateSecret: "rev-secret",
  cloudflareZoneId: "zone-1",
  cloudflarePurgeToken: "cf-token",
};

function recordingFetch(status = 200) {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      auth: new Headers(init.headers).get("authorization"),
      body: JSON.parse(String(init.body)),
    });
    return new Response(null, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("refreshPublicPropertyPage", () => {
  test("rebuilds the guest page first, then purges Cloudflare", async () => {
    const { fetch, calls } = recordingFetch();
    await refreshPublicPropertyPage("terme-di-saturnia", { env: FULL_ENV, fetch });

    expect(calls).toEqual([
      {
        url: "https://openbookings.co/api/revalidate",
        auth: "Bearer rev-secret",
        body: { paths: ["/p/terme-di-saturnia"] },
      },
      {
        url: "https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache",
        auth: "Bearer cf-token",
        body: { files: ["https://openbookings.co/p/terme-di-saturnia"] },
      },
    ]);
  });

  test("skips each step whose env vars are missing", async () => {
    const { fetch, calls } = recordingFetch();
    await refreshPublicPropertyPage("a", { env: { webUrl: "https://x.test" }, fetch });
    await refreshPublicPropertyPage("a", { env: { ...FULL_ENV, webUrl: undefined }, fetch });
    expect(calls).toEqual([]);
  });

  test("reports failures instead of throwing, and still purges", async () => {
    const { fetch, calls } = recordingFetch(500);
    const phases: string[] = [];
    await refreshPublicPropertyPage("a", { env: FULL_ENV, fetch, onError: (_, phase) => phases.push(phase) });
    expect(calls).toHaveLength(2);
    expect(phases).toEqual(["revalidate", "cdn-purge"]);
  });

  test("a malformed slug is never interpolated into a revalidate path or CDN URL", async () => {
    for (const slug of ["../admin", "a/b", "x?y=1", "x#y", "https://evil.example", "UPPER", "a b", "-lead", "trail-", "a--b", ""]) {
      const { fetch, calls } = recordingFetch();
      const errors: unknown[] = [];
      await refreshPublicPropertyPage(slug, { env: FULL_ENV, fetch, onError: (e) => errors.push(e) });
      expect(calls).toEqual([]);
      expect(errors).toHaveLength(1);
    }
  });
});
