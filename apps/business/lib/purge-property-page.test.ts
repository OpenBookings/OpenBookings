import { describe, expect, test } from "bun:test";
import { propertyPageKey } from "@openbookings/cache";
import { purgePropertyPage } from "./purge-property-page";

/**
 * A fake `queryOne` that answers the two lookups this module makes, so the
 * test needs no database. Recording the SQL lets us assert that a roomId is
 * resolved through `rooms`, not guessed at.
 */
function fakeQueryOne(rows: Record<string, { slug: string } | null>) {
  const seen: string[] = [];
  const queryOne = async <T>(text: string, values?: unknown[]): Promise<T | null> => {
    seen.push(text.replace(/\s+/g, " ").trim());
    const id = String(values?.[0] ?? "");
    return (rows[id] ?? null) as T | null;
  };
  return { queryOne, seen };
}

describe("purgePropertyPage", () => {
  test("resolves a propertyId to its slug and purges that key", async () => {
    const { queryOne, seen } = fakeQueryOne({ "prop-1": { slug: "terme-di-saturnia" } });
    const purged: string[][] = [];

    await purgePropertyPage(
      { propertyId: "prop-1" },
      { queryOne, purge: async (keys) => void purged.push(keys) },
    );

    expect(purged).toEqual([[propertyPageKey("terme-di-saturnia")]]);
    expect(seen[0]).toContain("FROM properties");
  });

  test("resolves a roomId through its property", async () => {
    const { queryOne, seen } = fakeQueryOne({ "room-1": { slug: "terme-di-saturnia" } });
    const purged: string[][] = [];

    await purgePropertyPage(
      { roomId: "room-1" },
      { queryOne, purge: async (keys) => void purged.push(keys) },
    );

    expect(purged).toEqual([[propertyPageKey("terme-di-saturnia")]]);
    expect(seen[0]).toContain("FROM rooms");
  });

  /**
   * Review Focus 4. The row can be gone — a property deleted in another tab, a
   * room removed between the write and this call. This runs inside a host's
   * save, so the only acceptable behaviour is to return quietly.
   */
  test("does nothing when the id resolves to no row", async () => {
    const { queryOne } = fakeQueryOne({});
    const purged: string[][] = [];

    await purgePropertyPage(
      { propertyId: "gone" },
      { queryOne, purge: async (keys) => void purged.push(keys) },
    );

    expect(purged).toEqual([]);
  });

  /**
   * A cache purge must never be the reason a host's save reports failure. The
   * save has already committed by the time we are called.
   */
  test("swallows a lookup failure instead of throwing into the save", async () => {
    const queryOne = async () => {
      throw new Error("pool exhausted");
    };
    let purgeCalled = false;

    await purgePropertyPage(
      { propertyId: "prop-1" },
      { queryOne, purge: async () => void (purgeCalled = true) },
    );

    expect(purgeCalled).toBe(false);
  });

  test("swallows a purge failure too", async () => {
    const { queryOne } = fakeQueryOne({ "prop-1": { slug: "s" } });

    await purgePropertyPage(
      { propertyId: "prop-1" },
      {
        queryOne,
        purge: async () => {
          throw new Error("upstash unreachable");
        },
      },
    );
  });

  test("lowercases a mixed-case slug column, matching the reader's key", async () => {
    const { queryOne } = fakeQueryOne({ "prop-1": { slug: "Terme-Di-Saturnia" } });
    const purged: string[][] = [];

    await purgePropertyPage(
      { propertyId: "prop-1" },
      { queryOne, purge: async (keys) => void purged.push(keys) },
    );

    expect(purged).toEqual([["ob:v1:prop-page:terme-di-saturnia"]]);
  });
});
