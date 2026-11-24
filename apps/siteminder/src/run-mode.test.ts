import { describe, expect, it } from "bun:test";
import type { CoreClient } from "./core-client";
import type { Queryable } from "./db/migrate";
import { startRunMode } from "./run-mode";
import type { TickDeps } from "./tick";

/** A database whose every query waits until the test lets it go, counting the ticks that reach it. */
function stalledDb() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const db = {
    queries: 0,
    release: () => release(),
    query: async () => {
      db.queries += 1;
      await gate;
      return { rows: [], rowCount: 0 };
    },
  };
  return db;
}

const deps = (db: ReturnType<typeof stalledDb>): TickDeps => ({
  db: db as unknown as Queryable,
  client: () => ({}) as unknown as CoreClient,
  now: () => new Date(),
  sleep: async () => {},
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("startRunMode", () => {
  it("always-on ticks on an interval and never starts a tick while one is running", async () => {
    const db = stalledDb();
    const stop = startRunMode(deps(db), "always-on", 0.02);
    try {
      await wait(120);
      // Several intervals passed, but the first tick is stuck on its first query: no second tick started.
      expect(db.queries).toBe(1);
      db.release();
      await wait(80);
      expect(db.queries).toBeGreaterThan(1);
    } finally {
      stop();
    }
    await wait(10); // a tick already running when stopped may finish
    const after = db.queries;
    await wait(60);
    expect(db.queries).toBe(after);
  });

  it("scale-to-zero starts no interval", async () => {
    const db = stalledDb();
    const stop = startRunMode(deps(db), "scale-to-zero", 0.02);
    await wait(60);
    stop();
    expect(db.queries).toBe(0);
  });
});
