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
 *
 * Authorization model: **no tool takes the guest's identity as an argument.**
 * Whose data a lookup may touch comes from `ToolContext`, which is derived
 * server-side from the Chatwoot contact on the conversation. Arguments are
 * model-controlled, and the model relays whatever the guest typed — so an
 * email or a payment id in the argument list is attacker-controlled input, not
 * proof of ownership. Every handler resolves a record, then checks it belongs
 * to the context guest before returning any of it.
 */

/** Server-derived identity of the guest in this conversation. Never model-supplied. */
export type ToolContext = {
  /** Chatwoot contact email, lowercased; null when the contact has none on file. */
  guestEmail: string | null;
};

/**
 * Returned both when nothing matches and when the match belongs to another
 * guest. The two cases must be indistinguishable, otherwise the tool becomes
 * an oracle for "does this booking reference exist".
 */
const NO_MATCHING_BOOKING = {
  found: false,
  note: "No booking with that reference on this guest's account. Ask them to re-check the reference in their confirmation email.",
} as const;

/**
 * Fail closed: an anonymous contact (web widget with no email captured) gets
 * no booking data at all. A human agent can verify identity out of band.
 */
const NO_VERIFIED_GUEST = {
  found: false,
  note: "This conversation has no verified guest account attached, so booking data cannot be looked up. Call escalate_to_human so an agent can verify the guest's identity.",
} as const;

/**
 * Ownership test. Both sides are normalised here rather than relying on the
 * caller having done it — a missed normalisation upstream would silently turn
 * into a failed match, or worse, a passing one.
 * Bookings with no guest email on record match nobody.
 */
function guestOwns(r: SupportReservation, guestEmail: string): boolean {
  const owner = r.guest_email?.trim().toLowerCase() ?? "";
  const guest = guestEmail.trim().toLowerCase();
  return owner.length > 0 && guest.length > 0 && owner === guest;
}

/** The context email, or null when it is absent or blank. */
function identifiedGuest(ctx: ToolContext): string | null {
  const email = ctx.guestEmail?.trim().toLowerCase();
  return email ? email : null;
}

/**
 * Resolve a reference to a booking the context guest actually owns, or null.
 * The single choke point every reference-taking tool goes through.
 */
async function findOwnedReservation(
  bookingReference: string,
  guestEmail: string,
): Promise<SupportReservation | null> {
  const r = await findReservationByReference(bookingReference);
  if (!r) return null;
  if (!guestOwns(r, guestEmail)) {
    trace("tools", "ownership check failed: reference belongs to another guest", {
      booking_reference: bookingReference,
    });
    return null;
  }
  return r;
}

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

// No guest_email field by design: the account is fixed by ToolContext. Omitting
// booking_reference means "this guest's recent bookings", which is why the
// schema has no required fields and no "at least one of" refinement.
const getReservationArgs = z.object({
  booking_reference: z
    .string()
    .describe(
      "The booking reference from the guest's confirmation (a UUID). Omit to list the guest's recent bookings.",
    )
    .optional(),
});

// No payment_intent_id field by design: a pi_ id carries no ownership link, so
// accepting one lets a guest read any payment on the platform. Payments are
// reachable only through a booking reference, which is ownership-checked.
const getPaymentStatusArgs = z.object({
  booking_reference: z.string().describe("Booking reference to look the payment up from."),
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
  execute?: (args: never, ctx: ToolContext) => Promise<unknown>;
};

export const TOOLS = {
  get_reservation: {
    description:
      "Look up the reservation(s) of the guest you are talking to. Provide booking_reference when the guest gives one (most precise); omit it to list their recent bookings. Lookups are automatically scoped to this guest's account — you cannot and need not specify whose bookings to fetch. Returns booking status, dates, property, amounts, and the cancellation policy tier per room.",
    schema: getReservationArgs,
    execute: async (args: z.infer<typeof getReservationArgs>, ctx: ToolContext) => {
      const guestEmail = identifiedGuest(ctx);
      if (!guestEmail) return NO_VERIFIED_GUEST;
      if (args.booking_reference) {
        const r = await findOwnedReservation(args.booking_reference, guestEmail);
        return r ? reservationView(r) : NO_MATCHING_BOOKING;
      }
      const rows = await findReservationsByGuestEmail(guestEmail);
      return rows.length > 0
        ? { found: true, bookings: rows.map(reservationView) }
        : { found: false, note: "No bookings on this guest's account." };
    },
  },
  get_payment_status: {
    description:
      "Look up the payment for one of this guest's bookings: payment status, amount, and refunds (if any). Identify the booking by booking_reference; the payment is resolved from it.",
    schema: getPaymentStatusArgs,
    execute: async (args: z.infer<typeof getPaymentStatusArgs>, ctx: ToolContext) => {
      const guestEmail = identifiedGuest(ctx);
      if (!guestEmail) return NO_VERIFIED_GUEST;
      const r = await findOwnedReservation(args.booking_reference, guestEmail);
      if (!r) return NO_MATCHING_BOOKING;
      if (!r.stripe_payment_intent_id) {
        return { found: false, note: "This booking has no payment on record yet." };
      }
      const summary = await getPaymentSummary(r.stripe_payment_intent_id);
      return summary ?? { found: false, note: "No payment found for that booking." };
    },
  },
  get_cancellation_policy: {
    description:
      "Get the cancellation policy that applies to one of this guest's bookings: the tier (Flexible / Moderate / Limited / Firm) and its terms, per room, for that booking's dates.",
    schema: getCancellationPolicyArgs,
    execute: async (args: z.infer<typeof getCancellationPolicyArgs>, ctx: ToolContext) => {
      const guestEmail = identifiedGuest(ctx);
      if (!guestEmail) return NO_VERIFIED_GUEST;
      const r = await findOwnedReservation(args.booking_reference, guestEmail);
      if (!r) return NO_MATCHING_BOOKING;
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
 *
 * `ctx` is required, not optional: a default would silently re-open the
 * unauthorized-lookup hole at any call site that forgot to pass it.
 */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
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
    return { ok: true, result: await def.execute(parsed.data as never, ctx) };
  } catch (err) {
    console.error(`Tool ${name} failed`, err);
    trace("tools", `${name} threw`, { err: String(err) });
    return { ok: false, error: `Tool ${name} failed to execute. Do not retry more than once; escalate if this blocks you.` };
  }
}

export { escalateArgs };
