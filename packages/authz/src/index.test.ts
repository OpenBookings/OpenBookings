import { describe, expect, test } from "bun:test";
import {
  getHostScopedDb,
  getThreadForParticipant,
  userOwnsProperty,
  userOwnsRatePlan,
  userOwnsRoom,
} from "./index";
import type { SessionLike, ThreadRow } from "./index";

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
const ratePlans = [
  { id: "plan-1", roomId: "room-1" },
  { id: "plan-orphan", roomId: "room-orphan" },
];

/** Mirrors the message_threads row shape queried in getThreadForParticipant. */
const threads: ThreadRow[] = [
  {
    id: "thread-1",
    booking_id: "booking-1",
    property_id: "prop-1",
    host_id: "host-a",
    guest_id: "guest-a",
    status: "open",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
];

const fakeQueryOne = async <T>(text: string, values: unknown[] = []): Promise<T | null> => {
  if (text.includes("FROM properties")) {
    const [propertyId, userId] = values as [string, string];
    const hit = properties.find((p) => p.id === propertyId && p.owner === userId);
    return (hit ? { ok: true } : null) as T | null;
  }
  if (text.includes("FROM rate_plans")) {
    const [ratePlanId, userId] = values as [string, string];
    const plan = ratePlans.find((rp) => rp.id === ratePlanId);
    const room = rooms.find((r) => r.id === plan?.roomId);
    const owner = properties.find((p) => p.id === room?.propertyId)?.owner;
    return (plan && owner === userId ? { ok: true } : null) as T | null;
  }
  if (text.includes("FROM rooms")) {
    const [roomId, userId] = values as [string, string];
    const room = rooms.find((r) => r.id === roomId);
    const owner = properties.find((p) => p.id === room?.propertyId)?.owner;
    return (room && owner === userId ? { ok: true } : null) as T | null;
  }
  if (text.includes("FROM message_threads")) {
    const [threadId, userId] = values as [string, string];
    const thread = threads.find(
      (t) => t.id === threadId && (t.host_id === userId || t.guest_id === userId),
    );
    return (thread ?? null) as T | null;
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

describe("getThreadForParticipant", () => {
  test("host participant is allowed and identified as host", async () => {
    const result = await getThreadForParticipant(sessionFor("host-a"), "thread-1", deps);
    expect(result?.role).toBe("host");
    expect(result?.thread.id).toBe("thread-1");
  });

  test("guest participant is allowed and identified as guest", async () => {
    const result = await getThreadForParticipant(sessionFor("guest-a"), "thread-1", deps);
    expect(result?.role).toBe("guest");
    expect(result?.thread.id).toBe("thread-1");
  });

  test("BOLA: an authenticated user who is neither host nor guest is rejected", async () => {
    expect(await getThreadForParticipant(sessionFor("host-b"), "thread-1", deps)).toBeNull();
  });

  test("unknown thread fails closed", async () => {
    expect(await getThreadForParticipant(sessionFor("host-a"), "nope", deps)).toBeNull();
  });

  test("missing session fails closed", async () => {
    expect(await getThreadForParticipant(null, "thread-1", deps)).toBeNull();
    expect(await getThreadForParticipant(undefined, "thread-1", deps)).toBeNull();
  });

  test("empty ids fail closed", async () => {
    expect(await getThreadForParticipant(sessionFor(""), "thread-1", deps)).toBeNull();
    expect(await getThreadForParticipant(sessionFor("host-a"), "", deps)).toBeNull();
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

describe("userOwnsRatePlan", () => {
  test("owner of the parent property is allowed", async () => {
    expect(await userOwnsRatePlan(sessionFor("host-a"), "plan-1", deps)).toBe(true);
  });

  test("BOLA: another authenticated host is rejected", async () => {
    expect(await userOwnsRatePlan(sessionFor("host-b"), "plan-1", deps)).toBe(false);
  });

  test("plan under an unowned property is inaccessible", async () => {
    expect(await userOwnsRatePlan(sessionFor("host-a"), "plan-orphan", deps)).toBe(false);
  });

  test("unknown rate plan fails closed", async () => {
    expect(await userOwnsRatePlan(sessionFor("host-a"), "nope", deps)).toBe(false);
  });

  test("missing session fails closed", async () => {
    expect(await userOwnsRatePlan(null, "plan-1", deps)).toBe(false);
  });
});
