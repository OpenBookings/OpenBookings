import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

const captured: unknown[][] = [];
let acceptError: unknown = null;

class Redirect extends Error {}

await mockModules(import.meta.dir, {
  "next/server": () => ({ after: (task: () => unknown) => void task() }),
  "next/headers": () => ({ headers: async () => new Headers() }),
  "next/navigation": () => ({
    redirect: (to: string) => {
      throw new Redirect(to);
    },
  }),
  "@openbookings/mailing/tracking": () => ({
    captureOutcome: async (...args: unknown[]) => {
      captured.push(args);
    },
  }),
  "@/lib/auth": () => ({
    getServerSession: async () => ({ user: { id: "u1" } }),
    auth: {
      api: {
        acceptInvitation: async () => {
          if (acceptError) throw acceptError;
        },
        rejectInvitation: async () => {},
      },
    },
  }),
}, ["@/lib/auth"]);

const { acceptInvite } = await import("./actions");

beforeEach(() => {
  captured.length = 0;
  acceptError = null;
});

describe("acceptInvite outcome event", () => {
  it("captures team_invitation_accepted for the signed-in invitee (consent-gated), before the redirect", async () => {
    await expect(acceptInvite("inv-1")).rejects.toBeInstanceOf(Redirect);
    expect(captured).toEqual([["team_invitation_accepted", { userId: "u1" }]]);
  });

  it("captures nothing when accepting fails", async () => {
    acceptError = { body: { message: "Invitation not found" } };
    expect(await acceptInvite("inv-1")).toEqual({ error: "Invitation not found" });
    expect(captured).toEqual([]);
  });
});
