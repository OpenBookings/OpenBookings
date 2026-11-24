import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { registerInstallation, unregisterInstallation } from "./registry";

type Call = { url: string; init: RequestInit };

function fakeFetch(status = 200): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status >= 400 ? "nope" : "{}", { status });
  };
  return { calls, fetch: impl as unknown as typeof fetch };
}

const registration = {
  installationId: "inst-1",
  propertyCode: "ABC",
  propertyName: "Hotel Test",
  apiKey: "obk_x",
  coreBaseUrl: "https://business.example",
};

describe("app registry", () => {
  const saved = { url: process.env.APP_SITEMINDER_URL, secret: process.env.APP_SITEMINDER_REGISTRATION_SECRET };
  beforeEach(() => {
    process.env.APP_SITEMINDER_URL = "https://sm.example/";
    process.env.APP_SITEMINDER_REGISTRATION_SECRET = "s3cret";
  });
  afterEach(() => {
    for (const [key, value] of [
      ["APP_SITEMINDER_URL", saved.url],
      ["APP_SITEMINDER_REGISTRATION_SECRET", saved.secret],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("registers an installation with the body and the bearer secret", async () => {
    const f = fakeFetch();
    await registerInstallation(registration, f.fetch);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("https://sm.example/installations");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual(registration);
  });

  it("removes an installation with a DELETE", async () => {
    const f = fakeFetch();
    await unregisterInstallation("inst-1", f.fetch);
    expect(f.calls[0]!.url).toBe("https://sm.example/installations/inst-1");
    expect(f.calls[0]!.init.method).toBe("DELETE");
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
  });

  it("throws when the app refuses", async () => {
    await expect(registerInstallation(registration, fakeFetch(401).fetch)).rejects.toThrow("401");
  });

  it("throws when the app is not configured", async () => {
    delete process.env.APP_SITEMINDER_URL;
    await expect(registerInstallation(registration, fakeFetch().fetch)).rejects.toThrow("APP_SITEMINDER_URL");
  });
});
