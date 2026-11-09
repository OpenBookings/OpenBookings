import { describe, expect, test } from "bun:test";
import { EXPORT_QUERIES, buildGuestExport } from "./export";

const NOW = new Date("2026-11-01T12:00:00Z");

describe("buildGuestExport", () => {
  test("a guest with nothing but an account gets empty lists, not missing keys", async () => {
    const run = async (sql: string) => (sql === EXPORT_QUERIES.user ? [{ id: "u1", name: "Anna", email: "a@b.co" }] : []);
    const data = await buildGuestExport("u1", run, NOW);
    expect(data).toEqual({
      exportedAt: "2026-11-01T12:00:00.000Z",
      account: { id: "u1", name: "Anna", email: "a@b.co" },
      contactDetails: null,
      signInMethods: [],
      passkeys: [],
      sessions: [],
      bookings: [],
      conversations: [],
      likedRooms: [],
      reviews: [],
      consentRecords: [],
    });
  });

  test("every query is scoped to the user and nothing secret is selected", async () => {
    const seen: { sql: string; values: unknown[] }[] = [];
    await buildGuestExport("u1", async (sql, values) => {
      seen.push({ sql, values });
      return [];
    }, NOW);
    expect(seen).toHaveLength(Object.keys(EXPORT_QUERIES).length);
    for (const { sql, values } of seen) {
      expect(values).toEqual(["u1"]);
      expect(sql).toContain("$1");
      expect(sql).not.toMatch(/\btoken\b|"publicKey"|"credentialID"|"accessToken"|"refreshToken"|"idToken"|\bpassword\b|SELECT \*/);
    }
  });
});
