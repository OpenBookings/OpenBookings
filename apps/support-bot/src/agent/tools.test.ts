import { describe, expect, it } from "bun:test";
import { classifyPolicyTier, executeTool, mistralToolSchemas, TOOLS } from "./tools";

describe("mistralToolSchemas", () => {
  it("declares all four tools with object parameter schemas", () => {
    const schemas = mistralToolSchemas();
    const names = schemas.map((s) => s.function.name).sort();
    expect(names).toEqual([
      "escalate_to_human",
      "get_cancellation_policy",
      "get_payment_status",
      "get_reservation",
    ]);
    for (const s of schemas) {
      expect((s.function.parameters as { type: string }).type).toBe("object");
    }
  });
});

describe("executeTool validation", () => {
  it("rejects get_reservation with neither booking_reference nor guest_email", async () => {
    const result = await executeTool("get_reservation", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("at least one");
  });

  it("rejects get_payment_status with neither identifier", async () => {
    const result = await executeTool("get_payment_status", {});
    expect(result.ok).toBe(false);
  });

  it("returns an error result (not a throw) for unknown tools", async () => {
    const result = await executeTool("delete_all_bookings", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown tool");
  });

  it("treats escalate_to_human as a signal, not an executable tool", async () => {
    expect("execute" in TOOLS.escalate_to_human).toBe(false);
    const result = await executeTool("escalate_to_human", { reason: "guest asked" });
    expect(result.ok).toBe(false);
  });
});

describe("classifyPolicyTier", () => {
  it("prefers an explicit tier word in the policy text", () => {
    expect(classifyPolicyTier(true, "Moderate: free cancellation until 5 days before")).toBe("Moderate");
    expect(classifyPolicyTier(false, "Limited — 50% back until 14 days before")).toBe("Limited");
  });

  it("falls back to refundability", () => {
    expect(classifyPolicyTier(true, null)).toBe("Flexible");
    expect(classifyPolicyTier(false, null)).toBe("Firm");
    expect(classifyPolicyTier(true, "Non-refundable rate")).toBe("Firm");
  });
});
