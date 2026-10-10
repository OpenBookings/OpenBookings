import { describe, expect, test } from "bun:test";
import { deriveProtection } from "./security-tasks";

const first = { createdAt: "2026-10-01T10:00:00Z" };
const second = { createdAt: "2026-10-05T10:00:00Z" };

describe("deriveProtection", () => {
  test("no passkey: the passkey is what is asked for", () => {
    const p = deriveProtection({ passkeys: [], otherSessionCount: 0 });
    expect(p.done).toBe(1);
    expect(p.total).toBe(2);
    expect(p.headline).toBe("Secure your account");
    expect(p.openTask?.id).toBe("passkey");
    expect(p.openTask?.action).toBe("Add passkey");
    expect(p.completed.map((t) => t.id)).toEqual(["sessions"]);
  });

  test("one passkey and no other sessions is full protection", () => {
    const p = deriveProtection({ passkeys: [first], otherSessionCount: 0 });
    expect(p.done).toBe(2);
    expect(p.headline).toBe("Your account is fully protected");
    expect(p.subline).toBe("You have a passkey and no unknown sessions.");
    expect(p.openTask).toBeNull();
    expect(p.completed.map((t) => t.id)).toEqual(["passkey", "sessions"]);
  });

  test("a second passkey changes nothing", () => {
    const p = deriveProtection({ passkeys: [first, second], otherSessionCount: 0 });
    expect(p.done).toBe(2);
    expect(p.total).toBe(2);
    expect(p.openTask).toBeNull();
  });

  test("only the first open task is offered, in order", () => {
    const p = deriveProtection({ passkeys: [], otherSessionCount: 2 });
    expect(p.done).toBe(0);
    expect(p.headline).toBe("Secure your account");
    expect(p.openTask?.id).toBe("passkey");
  });

  test("other sessions are asked about once there is a passkey, and counted in words that fit", () => {
    const many = deriveProtection({ passkeys: [first], otherSessionCount: 3 });
    expect(many.done).toBe(1);
    expect(many.headline).toBe("One step left to full protection");
    expect(many.openTask?.id).toBe("sessions");
    expect(many.openTask?.description).toBe("3 other devices are signed in.");
    expect(many.openTask?.action).toBe("Review sessions");

    const one = deriveProtection({ passkeys: [first], otherSessionCount: 1 });
    expect(one.openTask?.description).toBe("1 other device is signed in.");
  });

  test("the passkey step is dated by the earliest passkey, whatever order they arrive in", () => {
    const p = deriveProtection({ passkeys: [second, first], otherSessionCount: 0 });
    expect(p.completed.find((t) => t.id === "passkey")?.at).toBe(first.createdAt);
    expect(p.completed.find((t) => t.id === "sessions")?.note).toBe("Only this device is signed in");
  });

  test("a new device signing in reopens its step", () => {
    const before = deriveProtection({ passkeys: [first], otherSessionCount: 0 });
    const after = deriveProtection({ passkeys: [first], otherSessionCount: 1 });
    expect(before.openTask).toBeNull();
    expect(after.openTask?.id).toBe("sessions");
  });
});
