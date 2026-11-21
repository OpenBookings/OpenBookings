import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

const captured: unknown[][] = [];
let acceptError: unknown = null;
let hotels: { propertyId: string; organizationId: string }[] = [];
const switched: unknown[][] = [];

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
  "@/lib/current-property": () => ({ currentPropertyFor: async () => ({ propertyId: "pPrev" }) }),
  "@openbookings/authz": () => ({
    listSwitchableProperties: async () => hotels,
    setCurrentProperty: async (...args: unknown[]) => {
      switched.push(args);
      return {};
    },
  }),
  "@/lib/auth": () => ({
    getServerSession: async () => ({ user: { id: "u1" }, session: { id: "s1" } }),
    auth: {
      api: {
        acceptInvitation: async () => {
          if (acceptError) throw acceptError;
          return { invitation: { organizationId: "orgB" } };
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
  hotels = [];
  switched.length = 0;
});

describe("acceptInvite current hotel", () => {
  it("lands the new member in the invited org's first hotel", async () => {
    hotels = [
      { propertyId: "pA", organizationId: "orgA" },
      { propertyId: "pB1", organizationId: "orgB" },
      { propertyId: "pB2", organizationId: "orgB" },
    ];
    await expect(acceptInvite("inv-1")).rejects.toBeInstanceOf(Redirect);
    expect(switched).toEqual([[{ userId: "u1", sessionId: "s1" }, "pB1"]]);
  });

  it("re-applies the previous hotel when the member cannot read a hotel in that org yet", async () => {
    hotels = [{ propertyId: "pA", organizationId: "orgA" }];
    await expect(acceptInvite("inv-1")).rejects.toBeInstanceOf(Redirect);
    expect(switched).toEqual([[{ userId: "u1", sessionId: "s1" }, "pPrev"]]);
  });
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
