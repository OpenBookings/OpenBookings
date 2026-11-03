import { describe, expect, test } from "bun:test";
import { REASSIGN_OWNER_SQL, reassignPropertiesFromFormerOwner } from "./owner-sync";

describe("reassignPropertiesFromFormerOwner", () => {
  test("scopes to the org and user it was given and reports the row count", async () => {
    const calls: { text: string; values: unknown[] }[] = [];
    const pool = {
      query: async (text: string, values: unknown[]) => {
        calls.push({ text, values });
        return { rowCount: 2 };
      },
    };
    const n = await reassignPropertiesFromFormerOwner(pool, { organizationId: "org-1", userId: "u1" });
    expect(n).toBe(2);
    expect(calls).toEqual([{ text: REASSIGN_OWNER_SQL, values: ["org-1", "u1"] }]);
  });

  test("never clears the column and leaves still-owners and ownerless orgs alone", () => {
    // The SET target is a subselect of other owners, guarded so it cannot be NULL.
    expect(REASSIGN_OWNER_SQL).toContain(`m."userId" <> $2`);
    expect(REASSIGN_OWNER_SQL).toContain("NOT EXISTS");
    expect(REASSIGN_OWNER_SQL).not.toMatch(/owner_user_id\s*=\s*NULL/i);
  });
});
