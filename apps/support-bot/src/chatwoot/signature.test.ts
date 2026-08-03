import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyChatwootSignature } from "./signature";

const SECRET = "test-webhook-secret";
const BODY = JSON.stringify({ event: "message_created", id: 42 });

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyChatwootSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyChatwootSignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it("rejects a missing signature", () => {
    expect(verifyChatwootSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyChatwootSignature(BODY, sign(BODY, "wrong-secret"), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const tampered = BODY.replace("42", "43");
    expect(verifyChatwootSignature(tampered, sign(BODY, SECRET), SECRET)).toBe(false);
  });

  it("rejects malformed (non-hex, wrong-length) headers without throwing", () => {
    expect(verifyChatwootSignature(BODY, "not-hex!", SECRET)).toBe(false);
    expect(verifyChatwootSignature(BODY, "deadbeef", SECRET)).toBe(false);
    expect(verifyChatwootSignature(BODY, "", SECRET)).toBe(false);
  });
});
