import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { SIGNATURE_TOLERANCE_SECONDS, verifyChatwootSignature } from "./signature";

const SECRET = "test-webhook-secret";
const BODY = JSON.stringify({ event: "message_created", id: 42 });

/** Fixed clock so timestamp-window assertions don't depend on wall time. */
const NOW_MS = 1_770_000_000_000;
const TS = String(Math.floor(NOW_MS / 1000));

/** Sign exactly as Chatwoot does: HMAC over `{timestamp}.{raw_body}`. */
function sign(body: string, timestamp: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
}

function verify(
  body: string,
  signature: string | undefined,
  timestamp: string | undefined,
  opts: { nowMs?: number } = {},
) {
  return verifyChatwootSignature(body, signature, timestamp, SECRET, {
    nowMs: opts.nowMs ?? NOW_MS,
  });
}

describe("verifyChatwootSignature", () => {
  it("accepts a valid signature over {timestamp}.{body}", () => {
    expect(verify(BODY, sign(BODY, TS), TS)).toBe(true);
  });

  it("accepts a bare hex digest without the sha256= prefix", () => {
    expect(verify(BODY, sign(BODY, TS).replace("sha256=", ""), TS)).toBe(true);
  });

  it("rejects a signature over the body alone (the pre-timestamp scheme)", () => {
    const bodyOnly = createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex");
    expect(verify(BODY, `sha256=${bodyOnly}`, TS)).toBe(false);
  });

  it("rejects a missing signature or missing timestamp", () => {
    expect(verify(BODY, undefined, TS)).toBe(false);
    expect(verify(BODY, sign(BODY, TS), undefined)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verify(BODY, sign(BODY, TS, "wrong-secret"), TS)).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(verify(BODY.replace("42", "43"), sign(BODY, TS), TS)).toBe(false);
  });

  it("rejects a timestamp the signature was not made over", () => {
    // Replaying a valid capture under a fresh timestamp must not verify.
    const fresh = String(Number(TS) + 1);
    expect(verify(BODY, sign(BODY, TS), fresh)).toBe(false);
  });

  it("rejects a replayed request outside the tolerance window", () => {
    const old = String(Number(TS) - SIGNATURE_TOLERANCE_SECONDS - 1);
    expect(verify(BODY, sign(BODY, old), old)).toBe(false);

    const justInside = String(Number(TS) - SIGNATURE_TOLERANCE_SECONDS + 1);
    expect(verify(BODY, sign(BODY, justInside), justInside)).toBe(true);
  });

  it("rejects a far-future timestamp", () => {
    const future = String(Number(TS) + SIGNATURE_TOLERANCE_SECONDS + 1);
    expect(verify(BODY, sign(BODY, future), future)).toBe(false);
  });

  it("rejects malformed headers without throwing", () => {
    expect(verify(BODY, "not-hex!", TS)).toBe(false);
    expect(verify(BODY, "deadbeef", TS)).toBe(false);
    expect(verify(BODY, "", TS)).toBe(false);
    // Right length, but not hex — Buffer.from would silently truncate this.
    expect(verify(BODY, "z".repeat(64), TS)).toBe(false);
    expect(verify(BODY, sign(BODY, TS), "not-a-timestamp")).toBe(false);
    expect(verify(BODY, sign(BODY, TS), "")).toBe(false);
  });
});
