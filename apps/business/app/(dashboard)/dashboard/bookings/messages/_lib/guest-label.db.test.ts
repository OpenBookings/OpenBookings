import { afterAll, beforeAll, expect, test } from "bun:test";
import { Client } from "pg";
import { connectionString, describeWithDb } from "@openbookings/db/testing";
import { guestLabelSql } from "./guest-label";

describeWithDb("guest label in the thread list", () => {
  let db: Client;
  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });

  const label = async (first: string, last: string, name: string) =>
    (
      await db.query(
        `SELECT ${guestLabelSql("g")} AS label FROM (SELECT $1::text AS first_name, $2::text AS last_name, $3::text AS name) g`,
        [first, last, name],
      )
    ).rows[0].label;

  test("initial of the first name and the whole last name", async () => {
    expect(await label("Anna de", "Vries", "Anna de Vries")).toBe("A. Vries");
    expect(await label("Zoë", "García", "Zoë García")).toBe("Z. García");
  });

  test("with no last name it falls back to the old reading of the full name", async () => {
    expect(await label("Zoë", "", "Zoë")).toBe("Zoë");
    expect(await label("Anna de Vries", "", "Anna de Vries")).toBe("A. Vries");
  });

  test("with no first name the last name stands alone", async () => {
    expect(await label("", "Vries", "Vries")).toBe("Vries");
  });
});
