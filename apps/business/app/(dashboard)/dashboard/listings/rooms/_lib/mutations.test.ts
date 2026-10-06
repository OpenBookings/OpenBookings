import { describe, expect, test } from "bun:test";
import type { SessionLike } from "@openbookings/authz";
import {
  archiveRate,
  archiveRoom,
  createRoom,
  duplicateRate,
  NotFoundError,
  reorderRooms,
  saveRate,
  saveRoomAmenities,
  saveRoomIdentity,
  saveRoomSpace,
  setRateActive,
  setRoomPublished,
  type MutationDeps,
} from "./mutations";

/**
 * Every mutation must refuse a caller who does not own the property, before
 * it writes anything. These run without a database: the fake answers the
 * ownership queries @openbookings/authz issues (the same `$1 = id, $2 = user`
 * shape as the real ones) and records every statement it is handed, so
 * "nothing was written" is a direct assertion rather than an inference.
 *
 * The owner control at the bottom proves the fake is not refusing everyone.
 */

const OWNER = "host-owner";
const STRANGER = "host-stranger";
const PROPERTY = "11111111-1111-1111-1111-111111111111";
const ROOM = "22222222-2222-2222-2222-222222222222";
const RATE = "33333333-3333-3333-3333-333333333333";

const session = (id: string): SessionLike => ({ user: { id, account_type: "business" } });

function fakeDeps() {
  const statements: string[] = [];
  const isWrite = (sql: string) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);

  const queryOne = async <T,>(sql: string, values: unknown[] = []): Promise<T | null> => {
    statements.push(sql);
    // The authz package's three ownership checks.
    if (/SELECT TRUE AS ok/.test(sql)) {
      const [id, userId] = values as [string, string];
      const known = [PROPERTY, ROOM, RATE].includes(id);
      return (known && userId === OWNER ? { ok: true } : null) as T | null;
    }
    if (/FROM rooms WHERE id = \$1 AND archived_at IS NULL/.test(sql)) {
      return { id: ROOM, is_active: false } as T;
    }
    if (/FROM rate_plans rp JOIN rooms r/.test(sql)) {
      return { id: RATE, room_id: ROOM, is_active: true, priced: true, room_published: false } as T;
    }
    if (/COUNT/.test(sql)) return { n: 0 } as T;
    if (/RETURNING id/.test(sql)) return { id: "new-id", name: "x" } as T;
    return null;
  };

  const query = async <T,>(sql: string, values: unknown[] = []): Promise<T[]> => {
    statements.push(sql);
    if (/RETURNING r.id/.test(sql)) return (values[1] as string[]).map((id) => ({ id })) as T[];
    return [];
  };

  const deps: MutationDeps = {
    query,
    queryOne,
    transaction: (fn) => fn({ query, queryOne }),
    purge: async () => {},
    loadRoom: async () => null,
  };
  return { deps, writes: () => statements.filter(isWrite) };
}

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const value of Array.isArray(v) ? v : [v]) fd.append(k, value);
  }
  return fd;
}

const identityForm = () =>
  form({ roomId: ROOM, name: "Deluxe King", description: "x".repeat(60) });
const spaceForm = () =>
  form({ roomId: ROOM, sizeM2: "35", maxAdults: "2", maxChildren: "0", units: "3", bed_king: "1" });
const amenitiesForm = () =>
  form({ roomId: ROOM, amenityKeys: ["wifi"], featuredAmenityKeys: ["wifi"] });
const rateForm = (ratePlanId = "") =>
  form({ ratePlanId, roomId: ROOM, name: "Bed & Breakfast", minAdvanceDays: "0", maxAdvanceDays: "none" });

describe("a host who does not own the property", () => {
  const stranger = session(STRANGER);

  test.each([
    ["saveRoomIdentity", (d: MutationDeps) => saveRoomIdentity(stranger, identityForm(), d)],
    ["saveRoomSpace", (d: MutationDeps) => saveRoomSpace(stranger, spaceForm(), d)],
    ["saveRoomAmenities", (d: MutationDeps) => saveRoomAmenities(stranger, amenitiesForm(), d)],
    ["saveRate (create)", (d: MutationDeps) => saveRate(stranger, rateForm(), d)],
    ["saveRate (update)", (d: MutationDeps) => saveRate(stranger, rateForm(RATE), d)],
  ])("is refused by %s, and nothing is written", async (_name, run) => {
    const { deps, writes } = fakeDeps();
    await expect(run(deps)).rejects.toBeInstanceOf(NotFoundError);
    expect(writes()).toEqual([]);
  });

  test.each([
    ["createRoom", (d: MutationDeps) => createRoom(stranger, PROPERTY, d)],
    ["archiveRoom", (d: MutationDeps) => archiveRoom(stranger, ROOM, d)],
    ["reorderRooms", (d: MutationDeps) => reorderRooms(stranger, PROPERTY, [ROOM], d)],
    ["setRoomPublished", (d: MutationDeps) => setRoomPublished(stranger, ROOM, false, d)],
    ["setRateActive", (d: MutationDeps) => setRateActive(stranger, RATE, false, d)],
    ["duplicateRate", (d: MutationDeps) => duplicateRate(stranger, RATE, d)],
    ["archiveRate", (d: MutationDeps) => archiveRate(stranger, RATE, d)],
  ])("is refused by %s, and nothing is written", async (_name, run) => {
    const { deps, writes } = fakeDeps();
    const result = await run(deps);
    expect(result.ok).toBe(false);
    expect(writes()).toEqual([]);
  });

  test("gets the same answer as for an id that does not exist", async () => {
    const { deps } = fakeDeps();
    const theirs = await archiveRoom(stranger, ROOM, deps);
    const missing = await archiveRoom(session(OWNER), "99999999-9999-9999-9999-999999999999", deps);
    expect(theirs).toEqual(missing);
  });

  test("an unauthenticated session is refused", async () => {
    const { deps, writes } = fakeDeps();
    const anonymous = { user: { id: "" } } as SessionLike;
    expect((await createRoom(anonymous, PROPERTY, deps)).ok).toBe(false);
    await expect(saveRoomIdentity(anonymous, identityForm(), deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(writes()).toEqual([]);
  });
});

describe("the owner (control)", () => {
  const owner = session(OWNER);

  test("passes the same checks and writes", async () => {
    const { deps, writes } = fakeDeps();
    expect((await saveRoomIdentity(owner, identityForm(), deps)).success).toBe(true);
    expect((await setRateActive(owner, RATE, false, deps)).ok).toBe(true);
    expect((await reorderRooms(owner, PROPERTY, [ROOM], deps)).ok).toBe(true);
    expect(writes().length).toBe(3);
  });

  test("a new rate cannot be created active, because it has no price", async () => {
    const { deps, writes } = fakeDeps();
    const fd = rateForm();
    fd.append("active", "on");
    const state = await saveRate(owner, fd, deps);
    expect(state.success).toBe(false);
    expect(state.errors?.active?.[0]).toMatch(/no price/);
    expect(writes()).toEqual([]);
  });
});
