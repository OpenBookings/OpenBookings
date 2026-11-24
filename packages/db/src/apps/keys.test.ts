import { expect, test } from "bun:test";
import { generateAppKey, hashAppKey } from "./installations";

test("generateAppKey makes obk_ + 40 alphanumerics, never the same twice", () => {
  const a = generateAppKey();
  const b = generateAppKey();
  expect(a).toMatch(/^obk_[A-Za-z0-9]{40}$/);
  expect(b).toMatch(/^obk_[A-Za-z0-9]{40}$/);
  expect(a).not.toBe(b);
});

test("hashAppKey is a stable sha256 hex digest", () => {
  expect(hashAppKey("obk_x")).toMatch(/^[0-9a-f]{64}$/);
  expect(hashAppKey("obk_x")).toBe(hashAppKey("obk_x"));
  expect(hashAppKey("obk_x")).not.toBe(hashAppKey("obk_y"));
  expect(hashAppKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
