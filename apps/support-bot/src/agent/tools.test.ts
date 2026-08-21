import { beforeEach, describe, expect, it } from "bun:test";
import { reservations, resetMocks } from "../testing/mocks";
import type { ToolContext } from "./tools";

// Dynamic, like the other suites: the db doubles above must be registered
// before tools.ts binds its imports.
const { classifyPolicyTier, executeTool, mistralToolSchemas, TOOLS } = await import("./tools");

const GUEST: ToolContext = { guestEmail: "guest@example.com" };
const ANONYMOUS: ToolContext = { guestEmail: null };

const OWN_REF = "11111111-1111-1111-1111-111111111111";
const OTHER_REF = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  resetMocks();
  reservations.set(OWN_REF, { bookingId: OWN_REF, guestEmail: "guest@example.com" });
  reservations.set(OTHER_REF, { bookingId: OTHER_REF, guestEmail: "victim@example.com" });
});

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

  it("exposes no argument by which the model could name a different guest", () => {
    // Regression guard: the tools' authorization rests on identity being
    // absent from the argument surface. Re-adding a guest_email or a raw
    // payment_intent_id parameter would reopen the unauthorized-lookup hole.
    const forbidden = ["guest_email", "email", "payment_intent_id", "customer_id", "user_id"];
    for (const schema of mistralToolSchemas()) {
      const params = schema.function.parameters as { properties?: Record<string, unknown> };
      for (const name of Object.keys(params.properties ?? {})) {
        expect(forbidden).not.toContain(name);
      }
    }
  });
});

describe("tool authorization", () => {
  it("returns the guest's own booking by reference", async () => {
    const result = await executeTool("get_reservation", { booking_reference: OWN_REF }, GUEST);
    expect(result).toMatchObject({ ok: true, result: { booking_reference: OWN_REF } });
  });

  it("does not return another guest's booking by reference", async () => {
    const result = await executeTool("get_reservation", { booking_reference: OTHER_REF }, GUEST);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result).toMatchObject({ found: false });
    expect(JSON.stringify(result)).not.toContain("victim@example.com");
  });

  it("is not an existence oracle: a foreign booking looks exactly like a missing one", async () => {
    const foreign = await executeTool("get_reservation", { booking_reference: OTHER_REF }, GUEST);
    const missing = await executeTool(
      "get_reservation",
      { booking_reference: "33333333-3333-3333-3333-333333333333" },
      GUEST,
    );
    expect(foreign).toEqual(missing);
  });

  it("scopes an unqualified lookup to the context guest, not to anything in the args", async () => {
    // Extra keys are stripped by the schema, so a model that invents
    // `guest_email` cannot redirect the lookup.
    const result = await executeTool("get_reservation", { guest_email: "victim@example.com" }, GUEST);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const bookings = (result.result as { bookings?: Array<{ booking_reference: string }> }).bookings;
      expect(bookings?.map((b) => b.booking_reference)).toEqual([OWN_REF]);
    }
  });

  it("refuses payment and policy lookups for another guest's booking", async () => {
    for (const tool of ["get_payment_status", "get_cancellation_policy"]) {
      const result = await executeTool(tool, { booking_reference: OTHER_REF }, GUEST);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.result).toMatchObject({ found: false });
    }
  });

  it("returns no booking data at all for an unidentified contact", async () => {
    for (const [tool, args] of [
      ["get_reservation", {}],
      ["get_reservation", { booking_reference: OWN_REF }],
      ["get_payment_status", { booking_reference: OWN_REF }],
      ["get_cancellation_policy", { booking_reference: OWN_REF }],
    ] as const) {
      const result = await executeTool(tool, args, ANONYMOUS);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result).toMatchObject({ found: false });
        expect(JSON.stringify(result.result)).toContain("escalate_to_human");
      }
    }
  });

  it("matches the owner case-insensitively", async () => {
    const result = await executeTool("get_reservation", { booking_reference: OWN_REF }, {
      guestEmail: "guest@example.com",
    });
    reservations.set(OWN_REF, { bookingId: OWN_REF, guestEmail: "GUEST@Example.com" });
    const mixedCase = await executeTool("get_reservation", { booking_reference: OWN_REF }, GUEST);

    expect(result.ok).toBe(true);
    expect(mixedCase).toMatchObject({ ok: true, result: { booking_reference: OWN_REF } });
  });

  it("treats a booking with no guest email on record as owned by nobody", async () => {
    reservations.set(OWN_REF, { bookingId: OWN_REF, guestEmail: null });
    const result = await executeTool("get_reservation", { booking_reference: OWN_REF }, GUEST);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result).toMatchObject({ found: false });
  });
});

describe("executeTool validation", () => {
  it("rejects get_payment_status without a booking reference", async () => {
    const result = await executeTool("get_payment_status", {}, GUEST);
    expect(result.ok).toBe(false);
  });

  it("returns an error result (not a throw) for unknown tools", async () => {
    const result = await executeTool("delete_all_bookings", {}, GUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown tool");
  });

  it("treats escalate_to_human as a signal, not an executable tool", async () => {
    expect("execute" in TOOLS.escalate_to_human).toBe(false);
    const result = await executeTool("escalate_to_human", { reason: "guest asked" }, GUEST);
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
