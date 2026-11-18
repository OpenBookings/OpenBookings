import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

class Redirect extends Error {}
class NotFound extends Error {}

let session: { user: { id: string } } | null = null;
let loads = 0;

await mockModules(import.meta.dir, {
  "next/navigation": () => ({
    redirect: (to: string) => {
      throw new Redirect(to);
    },
    notFound: () => {
      throw new NotFound();
    },
  }),
  "@/lib/auth": () => ({ getServerSession: async () => session }),
  // The text itself is MDX, which only Next compiles; a stub stands in.
  "@/lib/legal/host-agreement": () => {
    const v = {
      version: "1.3",
      effectiveFrom: "2026-11-18",
      lastUpdated: "2026-11-18",
      load: async () => {
        loads++;
        return { default: () => null, title: "Host Agreement" };
      },
    };
    return { getHostAgreementVersion: (version: string) => (version === "1.3" ? v : undefined) };
  },
}, ["@/lib/auth"]);

const { renderHostAgreement } = await import("./render");

beforeEach(() => {
  session = null;
  loads = 0;
});

describe("Host Agreement page", () => {
  it("sends a visitor without a business session to sign in, without loading the text", async () => {
    const page = renderHostAgreement("1.3", "/legal/host-agreement");
    await expect(page).rejects.toBeInstanceOf(Redirect);
    await expect(page).rejects.toThrow("/login?redirect=%2Flegal%2Fhost-agreement");
    expect(loads).toBe(0);
  });

  it("does not reveal which versions exist to a visitor without a session", async () => {
    await expect(renderHostAgreement("9.9", "/legal/host-agreement/v/9.9")).rejects.toBeInstanceOf(Redirect);
  });

  it("renders the text for a signed-in host", async () => {
    session = { user: { id: "host-1" } };
    expect(await renderHostAgreement("1.3", "/legal/host-agreement")).toBeTruthy();
    expect(loads).toBe(1);
  });

  it("is a 404 for a version that was never published", async () => {
    session = { user: { id: "host-1" } };
    await expect(renderHostAgreement("9.9", "/legal/host-agreement/v/9.9")).rejects.toBeInstanceOf(NotFound);
  });
});
