import { describe, expect, test } from "bun:test";
import { appleUserInfo, decodeJwtPayload } from "./apple-user-info";

function jwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

describe("appleUserInfo", () => {
  test("first sign-in: real first and last name, joined name, claims kept", async () => {
    const r = await appleUserInfo({
      idToken: jwt({ sub: "001", email: "a@example.com", email_verified: "true" }),
      user: { name: { firstName: "Anna", lastName: "de Vries" } },
    });
    expect(r?.user).toEqual({
      name: "Anna de Vries",
      emailVerified: true,
      email: "a@example.com",
      firstName: "Anna",
      lastName: "de Vries",
    });
    expect(r?.data).toMatchObject({ sub: "001", email: "a@example.com", name: "Anna de Vries" });
  });

  test("second sign-in (no name): no firstName/lastName keys, so stored names survive", async () => {
    const r = await appleUserInfo({ idToken: jwt({ sub: "001", email: "a@example.com", email_verified: true }) });
    expect(r?.user).toEqual({ name: "", emailVerified: true, email: "a@example.com" });
    expect(r?.user).not.toHaveProperty("firstName");
    expect(r?.user).not.toHaveProperty("lastName");
  });

  test("name object without usable parts adds no name keys", async () => {
    const r = await appleUserInfo({ idToken: jwt({ sub: "1", email: "a@b.c" }), user: { name: {} } });
    expect(r?.user).toEqual({ name: "", emailVerified: false, email: "a@b.c" });
  });

  test("falls back to the id token's name claim; email_verified defaults to false", async () => {
    const r = await appleUserInfo({ idToken: jwt({ sub: "1", email: "a@b.c", name: "Zoë", email_verified: "nope" }) });
    expect(r?.user).toEqual({ name: "Zoë", emailVerified: false, email: "a@b.c" });
  });

  test("email_verified boolean false and string false", async () => {
    expect((await appleUserInfo({ idToken: jwt({ email_verified: false }) }))?.user.emailVerified).toBe(false);
    expect((await appleUserInfo({ idToken: jwt({ email_verified: "false" }) }))?.user.emailVerified).toBe(false);
  });

  test("no id token gives null", async () => {
    expect(await appleUserInfo({})).toBeNull();
  });
});

describe("decodeJwtPayload", () => {
  test("rejects malformed tokens", () => {
    expect(() => decodeJwtPayload("abc")).toThrow();
    expect(() => decodeJwtPayload(`a.${Buffer.from("[1]").toString("base64url")}.c`)).toThrow();
  });
});
