import { describe, expect, test } from "bun:test";
import { assertLocalDatabase, localDatabaseProblem } from "./local-db";

describe("localDatabaseProblem", () => {
  test.each([
    "postgres://postgres:pw@127.0.0.1:55432/siteminder",
    "postgres://postgres:postgres@localhost:5433/openbookings",
    "postgresql://u:p@LOCALHOST/db",
    "postgres://u:p@[::1]:5432/db",
    "postgres://u:p@127.0.0.1/db?sslmode=disable",
  ])("accepts %s", (url) => {
    expect(localDatabaseProblem(url)).toBeNull();
  });

  test.each([
    ["postgres://u:p@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require", "points at ep-example-pooler"],
    ["postgres://u:p@localhost/db?host=ep-example.neon.tech", "sets ?host="],
    ["postgres://u:p@localhost/db?HOST=ep-example.neon.tech", "sets ?HOST="],
    ["postgres://u:p@localhost/db?hostaddr=10.0.0.5", "sets ?hostaddr="],
    ["postgres://u:p@localhost/db?service=production", "sets ?service="],
    ["postgres://u:p@127.0.0.1.example.com/db", "points at 127.0.0.1.example.com"],
    ["postgres://%2Fvar%2Frun%2Fpostgresql/db", "points at /var/run/postgresql"],
    ["socket:/var/run/postgresql?db=openbookings", "uses socket:"],
    ["/var/run/postgresql openbookings", "is not a postgres:// URL"],
    ["mysql://u:p@localhost/db", "uses mysql:"],
    ["postgres:///openbookings", "names no host"],
    ["", "is not set"],
    ["   ", "is not set"],
    [undefined, "is not set"],
  ])("refuses %s", (url, reason) => {
    expect(localDatabaseProblem(url)).toContain(reason);
  });
});

describe("assertLocalDatabase", () => {
  test("returns the trimmed URL for a local database", () => {
    expect(assertLocalDatabase("DATABASE_URL", "  postgres://u:p@localhost/db \n")).toBe("postgres://u:p@localhost/db");
  });

  test("throws with the variable name and the reason, never the password", () => {
    const run = () => assertLocalDatabase("DATABASE_URL", "postgres://user:s3cret@db.example.com/prod");
    expect(run).toThrow("DATABASE_URL points at db.example.com, not this machine");
    try {
      run();
    } catch (e) {
      expect((e as Error).message).not.toContain("s3cret");
    }
  });
});
