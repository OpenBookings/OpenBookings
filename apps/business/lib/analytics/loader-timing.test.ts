import { describe, expect, test } from "bun:test";
import { createLoaderClock, GRACE_MS, HOLD_MS, holdRemaining, lineIndex, LINE_MS } from "./loader-timing";

describe("holdRemaining", () => {
  test("the loader shows straight away, with no grace period", () => {
    expect(GRACE_MS).toBe(0);
  });

  test("even an instant load keeps the loader up for the full second", () => {
    expect(HOLD_MS).toBe(1000);
    expect(holdRemaining(0, 0)).toBe(HOLD_MS);
    expect(holdRemaining(0, 3)).toBe(HOLD_MS - 3);
    expect(holdRemaining(0, 400)).toBe(HOLD_MS - 400);
  });

  test("a slow load has already been visible long enough", () => {
    expect(holdRemaining(0, HOLD_MS)).toBe(0);
    expect(holdRemaining(0, 3000)).toBe(0);
  });

  test("works from any starting time", () => {
    expect(holdRemaining(10_000, 10_400)).toBe(HOLD_MS - 400);
  });
});

describe("lineIndex", () => {
  test("the first line holds for one step", () => {
    expect(lineIndex(0, 4)).toBe(0);
    expect(lineIndex(GRACE_MS + LINE_MS - 1, 4)).toBe(0);
    expect(lineIndex(GRACE_MS + LINE_MS, 4)).toBe(1);
  });

  test("the last line stays put", () => {
    expect(lineIndex(GRACE_MS + LINE_MS * 10, 4)).toBe(3);
  });
});

describe("createLoaderClock", () => {
  test("content that mounts right after a loader inherits its start time", () => {
    const clock = createLoaderClock();
    expect(clock.begin(100)).toBe(100);
    clock.end(500);
    expect(clock.handover(500)).toBe(100);
  });

  test("a handover is taken once", () => {
    const clock = createLoaderClock();
    clock.begin(100);
    clock.end(500);
    clock.handover(500);
    expect(clock.handover(500)).toBeNull();
  });

  test("no loader, no handover", () => {
    expect(createLoaderClock().handover(500)).toBeNull();
  });

  test("a loader that ended long ago is not handed over", () => {
    const clock = createLoaderClock();
    clock.begin(100);
    clock.end(500);
    expect(clock.handover(5_000)).toBeNull();
  });

  test("a tab clicked mid-load keeps the running clock", () => {
    const clock = createLoaderClock();
    clock.begin(100);
    clock.end(700);
    expect(clock.begin(720)).toBe(100);
    clock.end(1_200);
    expect(clock.handover(1_200)).toBe(100);
  });

  test("a new load long after the last one starts fresh", () => {
    const clock = createLoaderClock();
    clock.begin(100);
    clock.end(700);
    expect(clock.begin(9_000)).toBe(9_000);
  });

  test("content mounting while the loader is still being torn down still gets the handover", () => {
    const clock = createLoaderClock();
    clock.begin(100);
    expect(clock.handover(400)).toBe(100);
  });
});
