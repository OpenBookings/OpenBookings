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
  it("is a no-op without config", async () => {
    const s = setup({ config: null });
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
