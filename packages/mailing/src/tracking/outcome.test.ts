import { beforeEach, afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ServerEvent } from "@openbookings/analytics/server";
import type { TrackingConfig } from "./config";
import { captureOutcome } from "./outcome";

let errorSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

const config: TrackingConfig = {
  key: Buffer.alloc(32, 7),
  baseUrl: "https://openbookings.co",
  ownHosts: ["openbookings.co"],
  consentVersion: 2,
};

function setup(over: Parameters<typeof captureOutcome>[3] = {}) {
  const captured: ServerEvent[] = [];
  const deps = {
    config,
    consentAccepted: async () => true,
    capture: async (e: ServerEvent) => {
      captured.push(e);
    },
    newId: () => "anon-1",
    ...over,
  };
  return { captured, deps };
}

describe("captureOutcome", () => {
  it("captures for a consented user", async () => {
    const s = setup();
    await captureOutcome("review_submitted", { userId: "u1" }, { booking: "b1" }, s.deps);
    expect(s.captured).toEqual([{ distinctId: "u1", event: "review_submitted", properties: { booking: "b1" } }]);
  });
  it("skips an unconsented user", async () => {
    const s = setup({ config, consentAccepted: async () => false });
    await captureOutcome("review_submitted", { userId: "u1" }, undefined, s.deps);
    expect(s.captured).toEqual([]);
  });
  it("captures anonymously with a fresh id", async () => {
    const s = setup();
    await captureOutcome("team_invitation_accepted", "anonymous", undefined, s.deps);
    expect(s.captured).toEqual([
      { distinctId: "anon-1", event: "team_invitation_accepted", properties: {}, anonymous: true },
    ]);
  });
  it("is a no-op without config", async () => {
    const s = setup({ config: null });
    await captureOutcome("stay_marked_arrived", "anonymous", undefined, s.deps);
    await captureOutcome("stay_marked_arrived", { userId: "u1" }, undefined, s.deps);
    expect(s.captured).toEqual([]);
  });
  it("resolves without capturing when the consent check throws", async () => {
    const s = setup({
      config,
      consentAccepted: async () => {
        throw new Error("db");
      },
    });
    await expect(captureOutcome("support_thread_viewed", { userId: "u1" }, undefined, s.deps)).resolves.toBeUndefined();
    expect(s.captured).toEqual([]);
  });
});
