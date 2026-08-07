import { z } from "zod";
import {
  findReservationByReference,
  findReservationsByGuestEmail,
  type SupportReservation,
} from "@openbookings/db";
import { getPaymentSummary } from "@openbookings/stripe";
import { trace } from "../trace";

/**
 * Tool registry for the Mistral agent: one Zod schema per tool's arguments,
 * validated before the handler runs. `escalate_to_human` has no handler here —
 * the loop treats it as a terminal signal.
 */

export type PolicyTier = "Flexible" | "Moderate" | "Limited" | "Firm";

/**
 * Rate plans store cancellation policy as host-written free text plus an
 * is_refundable flag; the four marketplace tiers are derived: explicit tier
 * word in the text wins, otherwise refundability decides the extreme.
 */
export function classifyPolicyTier(
  isRefundable: boolean,
  policyText: string | null,
): PolicyTier {
  const text = policyText ?? "";
  if (/\bflexible\b/i.test(text)) return "Flexible";
  if (/\bmoderate\b/i.test(text)) return "Moderate";
  if (/\blimited\b/i.test(text)) return "Limited";
  if (/\bfirm\b|non.?refundable|no refunds?\b/i.test(text)) return "Firm";
  return isRefundable ? "Flexible" : "Firm";
}

function reservationView(r: SupportReservation) {
  return {
    booking_reference: r.booking_id,
    status: r.status,
    check_in_date: r.check_in_date,
    check_out_date: r.check_out_date,
    check_in_time: r.check_in_time,
    check_out_time: r.check_out_time,
    total_amount_cents: r.total_amount,
    currency: r.currency,
    property: { name: r.property_name, city: r.property_city, country: r.property_country },
    cancelled_at: r.cancelled_at,
    cancellation_reason: r.cancellation_reason,
    rooms: r.rooms.map((room) => ({
      room: room.room_name,
      rate_plan: room.rate_plan_name,
      adults: room.adults,
      children: room.children,
      nights: room.total_nights,
      price_per_night_cents: room.price_per_night,
      cancellation_policy_tier: classifyPolicyTier(room.is_refundable, room.cancellation_policy),
      cancellation_policy_terms:
        room.cancellation_policy ??
        (room.is_refundable ? "Free cancellation" : "Non-refundable"),
    })),
  };
}

const getReservationArgs = z
  .object({
    booking_reference: z
      .string()
      .describe("The booking reference from the guest's confirmation (a UUID).")
      .optional(),
    guest_email: z
      .string()
      .describe("Email address the guest booked with.")
      .optional(),
  })
  // Mistral's JSON schema (`required: []`) can't express "at least one of",
  // so the runtime schema enforces it.
  .refine((a) => a.booking_reference || a.guest_email, {
    message: "Provide booking_reference or guest_email (at least one).",
  });

const getPaymentStatusArgs = z
  .object({
    payment_intent_id: z
      .string()
      .describe("Stripe payment intent id (starts with pi_).")
      .optional(),
    booking_reference: z
      .string()
      .describe("Booking reference to look the payment up from.")
      .optional(),
  })
  .refine((a) => a.payment_intent_id || a.booking_reference, {
    message: "Provide payment_intent_id or booking_reference (at least one).",
  });

const getCancellationPolicyArgs = z.object({
  booking_reference: z.string().describe("The booking reference (a UUID)."),
});

const escalateArgs = z.object({
  reason: z
    .string()
    .describe("Short summary for the human agent: what the guest needs and why the bot is handing off."),
});

export type ToolDefinition = {
  description: string;
  schema: z.ZodType;
  /** Absent for signal tools (escalate_to_human) — the loop intercepts those. */
  execute?: (args: never) => Promise<unknown>;
};

export const TOOLS = {
  get_reservation: {
    description:
      "Look up a guest's reservation(s). Provide booking_reference when the guest gives one (most precise); otherwise provide guest_email to list their recent bookings — at least one of the two is required. Returns booking status, dates, property, amounts, and the cancellation policy tier per room.",
    schema: getReservationArgs,
    execute: async (args: z.infer<typeof getReservationArgs>) => {
      if (args.booking_reference) {
        const r = await findReservationByReference(args.booking_reference);
        return r
          ? reservationView(r)
          : { found: false, note: "No booking with that reference. Ask the guest to re-check it, or look up by the email they booked with." };
      }
      const rows = await findReservationsByGuestEmail(args.guest_email!);
      return rows.length > 0
        ? { found: true, bookings: rows.map(reservationView) }
        : { found: false, note: "No bookings for that email. Ask the guest which email they booked with." };
    },
  },
  get_payment_status: {
    description:
      "Look up the payment for a booking: payment status, amount, and refunds (if any). Provide payment_intent_id if known, or booking_reference to resolve the payment from the booking.",
    schema: getPaymentStatusArgs,
    execute: async (args: z.infer<typeof getPaymentStatusArgs>) => {
      let paymentIntentId = args.payment_intent_id;
      if (!paymentIntentId) {
        const r = await findReservationByReference(args.booking_reference!);
        if (!r) return { found: false, note: "No booking with that reference." };
        if (!r.stripe_payment_intent_id) {
          return { found: false, note: "This booking has no payment on record yet." };
        }
        paymentIntentId = r.stripe_payment_intent_id;
      }
      const summary = await getPaymentSummary(paymentIntentId);
      return summary ?? { found: false, note: "No payment found for that id." };
    },
  },
  get_cancellation_policy: {
    description:
      "Get the cancellation policy that applies to a specific booking: the tier (Flexible / Moderate / Limited / Firm) and its terms, per room, for that booking's dates.",
    schema: getCancellationPolicyArgs,
    execute: async (args: z.infer<typeof getCancellationPolicyArgs>) => {
      const r = await findReservationByReference(args.booking_reference);
      if (!r) return { found: false, note: "No booking with that reference." };
      return {
        booking_reference: r.booking_id,
        check_in_date: r.check_in_date,
        check_out_date: r.check_out_date,
        status: r.status,
        policies: r.rooms.map((room) => ({
          room: room.room_name,
          rate_plan: room.rate_plan_name,
          tier: classifyPolicyTier(room.is_refundable, room.cancellation_policy),
          terms:
            room.cancellation_policy ??
            (room.is_refundable ? "Free cancellation" : "Non-refundable"),
        })),
      };
    },
  },
  escalate_to_human: {
    description:
      "Hand the conversation to a human support agent. Call this when the guest asks for a person, when the request involves a dispute/chargeback or an action you cannot perform (refunds, changes), or when you cannot resolve the question with your tools. Pass a short reason summarizing what the guest needs.",
    schema: escalateArgs,
    // Signal tool: no execute — the loop treats a call to it as terminal.
  },
} satisfies Record<string, ToolDefinition>;

export type ToolName = keyof typeof TOOLS;

/** Tool declarations in the shape Mistral's chat API expects. */
export function mistralToolSchemas() {
  return Object.entries(TOOLS).map(([name, def]) => ({
    type: "function" as const,
    function: {
      name,
      description: def.description,
      // Refinements (the "at least one of" checks) don't serialize to JSON
      // schema; the runtime schema in executeTool still enforces them.
      parameters: z.toJSONSchema(def.schema, { io: "input", target: "draft-7" }) as Record<
        string,
        unknown
      >,
    },
  }));
}

export type ToolExecutionResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/**
 * Validate and run a tool call coming back from the model. Unknown tools and
 * invalid arguments become error results fed back to the model — never throws
 * for model-controlled input. `escalate_to_human` must be intercepted by the
 * loop before this is called.
 */
export async function executeTool(name: string, rawArgs: unknown): Promise<ToolExecutionResult> {
  const def = (TOOLS as Record<string, ToolDefinition>)[name];
  if (!def || !def.execute) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  const parsed = def.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const error = `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
    trace("tools", `${name} rejected: invalid args`, { error });
    return { ok: false, error };
  }
  try {
    return { ok: true, result: await def.execute(parsed.data as never) };
  } catch (err) {
    console.error(`Tool ${name} failed`, err);
    trace("tools", `${name} threw`, { err: String(err) });
    return { ok: false, error: `Tool ${name} failed to execute. Do not retry more than once; escalate if this blocks you.` };
  }
}

export { escalateArgs };
