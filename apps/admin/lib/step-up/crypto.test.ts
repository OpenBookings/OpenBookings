import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("TOTP secret encryption", () => {
  test("round-trips a secret", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(enc).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(enc, key)).toBe("JBSWY3DPEHPK3PXP");
    // A fresh IV every time.
    expect(encryptSecret("JBSWY3DPEHPK3PXP", key)).not.toBe(enc);
  });

  test("refuses a tampered ciphertext", () => {
    const [v, iv, tag, ct] = encryptSecret("JBSWY3DPEHPK3PXP", key).split(":");
    const flipped = Buffer.from(ct!, "base64");
    flipped[0]! ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"), key)).toThrow();
    expect(() => decryptSecret(["v2", iv, tag, ct].join(":"), key)).toThrow();
    expect(() => decryptSecret(encryptSecret("x", key), randomBytes(32).toString("base64"))).toThrow();
  });

  test("refuses a key that is not 32 bytes", () => {
    expect(() => encryptSecret("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => encryptSecret("x", "")).toThrow(/32 bytes/);
    expect(() => decryptSecret(encryptSecret("x", key), randomBytes(31).toString("base64"))).toThrow(/32 bytes/);
  });
});
