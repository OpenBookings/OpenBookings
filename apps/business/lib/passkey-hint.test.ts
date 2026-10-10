import { describe, expect, test } from "bun:test";
import { forgetPasskey, hasPasskeyHint, rememberPasskey } from "./passkey-hint";

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const throwingStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("passkey hint", () => {
  test("is absent until a passkey is remembered", () => {
    const store = memoryStore();
    expect(hasPasskeyHint(store)).toBe(false);
    rememberPasskey(store);
    expect(hasPasskeyHint(store)).toBe(true);
  });

  test("forgetting removes it", () => {
    const store = memoryStore();
    rememberPasskey(store);
    forgetPasskey(store);
    expect(hasPasskeyHint(store)).toBe(false);
  });

  test("no storage means no hint, and nothing throws", () => {
    expect(hasPasskeyHint(null)).toBe(false);
    expect(() => rememberPasskey(null)).not.toThrow();
    expect(() => forgetPasskey(null)).not.toThrow();
  });

  test("storage that throws is treated as no hint", () => {
    expect(hasPasskeyHint(throwingStore)).toBe(false);
    expect(() => rememberPasskey(throwingStore)).not.toThrow();
    expect(() => forgetPasskey(throwingStore)).not.toThrow();
  });
});
