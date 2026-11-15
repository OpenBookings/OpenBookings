import { describe, expect, it } from "bun:test";
import { clickResponse, openResponse, type Schedule } from "./respond";

function recorder() {
  const tasks: Array<() => Promise<void>> = [];
  const schedule: Schedule = (t) => void tasks.push(t);
  return { tasks, schedule };
}

describe("email tracking responses with a bad token", () => {
  it("open returns the gif with no-store and schedules the handler", async () => {
    const r = recorder();
    const res = openResponse("garbage", null, r.schedule);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await res.arrayBuffer()).byteLength).toBe(42);
    expect(r.tasks).toHaveLength(1);
    await r.tasks[0]!();
  });

  it("click redirects to the web home and schedules the handler", async () => {
    const r = recorder();
    const res = clickResponse("garbage", "UA", r.schedule);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^https?:\/\/[^/]+\/?$/);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(r.tasks).toHaveLength(1);
    await r.tasks[0]!();
  });
});
