import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { userAdditionalFields } from "./shared";

// Sign-up runs the same parseInputData as /update-user, so it pins the
// validator on the shared additional fields without a database.
const auth = () =>
  betterAuth({
    baseURL: "http://app.localhost:3002",
    secret: "test-secret-test-secret-test-secret-1234",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    user: { additionalFields: userAdditionalFields },
  });

const signUp = (firstName: unknown, lastName: unknown) =>
  auth().api.signUpEmail({
    body: {
      email: `a${Math.random().toString(36).slice(2)}@example.test`,
      password: "correct-horse-battery",
      name: "x",
      firstName,
      lastName,
    } as never,
  });

describe("first and last name input validation", () => {
  test("accepts names up to 50 characters", async () => {
    const res = await signUp("a".repeat(50), "b".repeat(50));
    expect(res.user).toBeDefined();
  });

  test("rejects a first name over 50 characters", async () => {
    await expect(signUp("a".repeat(51), "Vries")).rejects.toThrow();
  });

  test("rejects a last name over 50 characters", async () => {
    await expect(signUp("Anna", "b".repeat(51))).rejects.toThrow();
  });

  test("rejects non-string names", async () => {
    await expect(signUp(123, "Vries")).rejects.toThrow();
    await expect(signUp("Anna", { x: 1 })).rejects.toThrow();
  });
});
