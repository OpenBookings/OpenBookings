import { describe, expect, test } from "bun:test";
import { REDACTED_MESSAGE_BODY } from "@openbookings/messaging/redaction";
import { anonymizeGuestData, assertCanDeleteAccount, UPCOMING_STAY_SQL } from "./deletion";

type Call = { sql: string; values: unknown[] };

function recorder(rows: unknown[] = []) {
  const calls: Call[] = [];
  const run = async (sql: string, values: unknown[]) => {
    calls.push({ sql, values });
    return rows;
  };
  return { calls, run };
}

describe("assertCanDeleteAccount", () => {
  test("refuses while a stay has not ended, with a reason the guest can act on", async () => {
    const { run } = recorder([{ id: "b1" }]);
    const err = await assertCanDeleteAccount("u1", run, "2026-11-01").catch((e) => e);
    expect(err?.body?.code).toBe("UPCOMING_STAY");
    expect(err?.body?.message).toBe(
      "You have a stay that hasn't ended yet. You can delete your account after it ends, or once it's cancelled.",
    );
  });

  test("allows it when no stay is still to come", async () => {
    const { run, calls } = recorder([]);
    await expect(assertCanDeleteAccount("u1", run, "2026-11-01")).resolves.toBeUndefined();
    expect(calls[0]).toEqual({ sql: UPCOMING_STAY_SQL, values: ["u1", "2026-11-01"] });
  });

  test("the query counts checkout day as not ended, and ignores cancelled and unpaid bookings", () => {
    expect(UPCOMING_STAY_SQL).toContain("check_out_date >= $2::date");
    expect(UPCOMING_STAY_SQL).toContain("status IN ('confirmed', 'checked_in')");
    expect(UPCOMING_STAY_SQL).toContain("user_id = $1");
  });
});

describe("anonymizeGuestData", () => {
  test("unlinks consent records and guest messages, and closes the guest's threads, all for this user only", async () => {
    const { run, calls } = recorder();
    await anonymizeGuestData("u1", run);
    expect(calls.map((c) => c.values)).toEqual([["u1"], ["u1", REDACTED_MESSAGE_BODY], ["u1"]]);
    expect(calls[0].sql).toContain("UPDATE consent_log SET user_id = NULL WHERE user_id = $1");
    expect(calls[1].sql).toContain("UPDATE messages SET sender_id = NULL, body = $2 WHERE sender_id = $1 AND sender_role = 'guest'");
    expect(calls[2].sql).toContain("UPDATE message_threads SET status = 'closed'");
    expect(calls[2].sql).toContain("WHERE guest_id = $1");
  });
});
