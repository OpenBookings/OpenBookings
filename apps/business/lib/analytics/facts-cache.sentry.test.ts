/**
 * A failed cache write is reported to Sentry and logged, and the page still
 * gets its facts: the cache is an optimisation.
 */
import { expect, test } from "bun:test";
import { mockModules } from "@/lib/mock-modules";
import type { MonthStore } from "./facts-cache";
import type { Facts } from "./types";

const captured: unknown[] = [];
await mockModules(import.meta.dir, {
  "@sentry/nextjs": () => ({ captureException: (error: unknown) => captured.push(error) }),
});
const { assembleFacts } = await import("./facts-cache");

test("a failed month write reaches Sentry and does not fail the page", async () => {
  const empty: Facts = { bookings: [], inventory: [], nights: [], roomTypeNames: {}, ratePlanNames: {} };
  const boom = new Error("cache table locked");
  const store: MonthStore = {
    read: async () => new Map(),
    generations: async (_p, months) => ({ months: new Map(months.map((m) => [m, 0])), hotel: 0 }),
    write: async () => {
      throw boom;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const facts = await assembleFacts("hotel-1", { from: "2031-04-01", to: "2031-04-30" }, "2031-06-15", {
      store,
      loadLive: async () => empty,
      loadNames: async () => ({ roomTypeNames: {}, ratePlanNames: {} }),
    });
    expect(facts.bookings).toEqual([]);
  } finally {
    console.error = originalError;
  }
  expect(captured).toEqual([boom]);
});
