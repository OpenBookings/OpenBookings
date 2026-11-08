import { expect, test } from "bun:test";
import { classifyQuery } from "./search";

const uuid = "b0000000-0000-4000-8000-000000000011";

test("classifies blank as empty", () => {
  expect(classifyQuery("").kind).toBe("empty");
  expect(classifyQuery("  ").kind).toBe("empty");
});
test("classifies a uuid", () => {
  expect(classifyQuery(uuid)).toEqual({ kind: "uuid", value: uuid });
});
test("classifies a payment intent", () => {
  expect(classifyQuery("pi_3Abc").kind).toBe("payment_intent");
});
test("classifies an email", () => {
  expect(classifyQuery("ann@x.nl").kind).toBe("email");
});
test("classifies text and trims", () => {
  expect(classifyQuery("Saturnia").kind).toBe("text");
  expect(classifyQuery(" Saturnia ")).toEqual({ kind: "text", value: "Saturnia" });
});
test("a uuid missing a character is an id prefix, not a uuid", () => {
  expect(classifyQuery(uuid.slice(1)).kind).toBe("id_prefix");
});
test("classifies id prefixes", () => {
  expect(classifyQuery("b0000000").kind).toBe("id_prefix");
  expect(classifyQuery("b0000000-0000").kind).toBe("id_prefix");
  expect(classifyQuery("deadbeef").kind).toBe("id_prefix");
  expect(classifyQuery("abc").kind).toBe("text");
});
