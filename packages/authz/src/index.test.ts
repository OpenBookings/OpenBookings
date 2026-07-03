import { describe, expect, test } from "bun:test";
import { getHostScopedDb, userOwnsProperty, userOwnsRoom } from "./index";
import type { SessionLike } from "./index";

const sessionFor = (id: string, accountType = "business"): SessionLike => ({
  user: { id, account_type: accountType },
});

/**
 * Fake DB: one property owned by user "host-a" containing room "room-1",
 * plus an unowned property (owner_user_id NULL) containing "room-orphan".
 * Mirrors the two real queries in src/index.ts.
 */
const properties = [
  { id: "prop-1", owner: "host-a" },
  { id: "prop-null", owner: null },
];
const rooms = [
  { id: "room-1", propertyId: "prop-1" },
  { id: "room-orphan", propertyId: "prop-null" },
];

const fakeQueryOne = async <T>(text: string, values: unknown[] = []): Promise<T | null> => {
  if (text.includes("FROM properties")) {
    const [propertyId, userId] = values as [string, string];
    const hit = properties.find((p) => p.id === propertyId && p.owner === userId);
    return (hit ? { ok: true } : null) as T | null;
  }
  if (text.includes("FROM rooms")) {
    const [roomId, userId] = values as [string, string];
    const room = rooms.find((r) => r.id === roomId);
    const owner = properties.find((p) => p.id === room?.propertyId)?.owner;
    return (room && owner === userId ? { ok: true } : null) as T | null;
  }
  throw new Error(`unexpected query: ${text}`);
};

const deps = { queryOne: fakeQueryOne };

describe("userOwnsProperty", () => {
  test("owner is allowed", async () => {
    expect(await userOwnsProperty(sessionFor("host-a"), "prop-1", deps)).toBe(true);
  });

  test("BOLA: another authenticated host is rejected", async () => {
    expect(await userOwnsProperty(sessionFor("host-b"), "prop-1", deps)).toBe(false);
  });

  test("unowned property (NULL owner) is inaccessible to everyone", async () => {
    expect(await userOwnsProperty(sessionFor("host-a"), "prop-null", deps)).toBe(false);
  });

  test("unknown property fails closed", async () => {
    expect(await userOwnsProperty(sessionFor("host-a"), "nope", deps)).toBe(false);
  });

  test("missing session fails closed", async () => {
    expect(await userOwnsProperty(null, "prop-1", deps)).toBe(false);
    expect(await userOwnsProperty(undefined, "prop-1", deps)).toBe(false);
  });

  test("empty ids fail closed", async () => {
    expect(await userOwnsProperty(sessionFor(""), "prop-1", deps)).toBe(false);
    expect(await userOwnsProperty(sessionFor("host-a"), "", deps)).toBe(false);
  });
});

describe("userOwnsRoom (resolves through property ownership)", () => {
  test("property owner owns the room", async () => {
    expect(await userOwnsRoom(sessionFor("host-a"), "room-1", deps)).toBe(true);
  });

  test("BOLA: another authenticated host is rejected", async () => {
    expect(await userOwnsRoom(sessionFor("host-b"), "room-1", deps)).toBe(false);
  });

  test("room in unowned property is inaccessible", async () => {
    expect(await userOwnsRoom(sessionFor("host-a"), "room-orphan", deps)).toBe(false);
  });

  test("unknown room fails closed", async () => {
    expect(await userOwnsRoom(sessionFor("host-a"), "nope", deps)).toBe(false);
  });

  test("missing session fails closed", async () => {
    expect(await userOwnsRoom(null, "room-1", deps)).toBe(false);
  });
});

describe("getHostScopedDb", () => {
  test("rejects missing session", () => {
    expect(() => getHostScopedDb(null)).toThrow();
    expect(() => getHostScopedDb(undefined)).toThrow();
  });

  test("rejects non-business sessions", () => {
    expect(() => getHostScopedDb(sessionFor("guest-1", "private"))).toThrow(
      /business/,
    );
  });

  test("derives scope from the session, exposing it as ownerUserId", () => {
    const host = getHostScopedDb(sessionFor("host-a"));
    expect(host.ownerUserId).toBe("host-a");
  });
});
