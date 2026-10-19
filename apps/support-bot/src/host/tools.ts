import { z } from "zod";
import { getPaymentSummary } from "@openbookings/stripe";
import type { AgentProfile } from "../agent/loop";
import { buildToolSchemas, escalateArgs, runTool, type ToolDefinition } from "../agent/tools";
import { HOST_SYSTEM_PROMPT } from "./prompt";
import { findHostBooking, listHostBookings, type HostBooking } from "./queries";

/**
 * Tool registry for host tickets. Same authorization model as the guest
 * tools: **no tool takes the host's identity as an argument**. Whose
 * properties a lookup may touch comes from `HostToolContext`, derived on the
 * server from the HMAC-verified Chatwoot contact; every query enforces it in
 * SQL.
 */

export type HostToolContext = {
  /** Business user id from the Chatwoot contact identifier; null if missing. */
  hostUserId: string | null;
};

/** Missing and out-of-scope must look the same, or the tool leaks existence. */
const NO_MATCHING_BOOKING = {
  found: false,
  note: "No booking with that reference on this host's properties. Ask the host to check the reference shown on the booking.",
} as const;

const AMBIGUOUS_BOOKING = {
  found: false,
  note: "More than one booking starts with that reference. Ask the host for a few more characters.",
} as const;

const NO_VERIFIED_HOST = {
  found: false,
  note: "This conversation has no verified host account attached, so booking data cannot be looked up. Call escalate_to_human.",
} as const;

function bookingView(b: HostBooking) {
  return {
    booking_reference: b.booking_id,
    short_reference: `#${b.booking_id.slice(0, 8)}`,
    status: b.status,
    check_in_date: b.check_in_date,
    check_out_date: b.check_out_date,
    property: b.property_name,
    guest_name: b.guest_name,
    total_amount: b.total_amount,
    booking_fee_amount: b.booking_fee_amount,
    currency: b.currency,
    created_at: b.created_at,
    cancelled_at: b.cancelled_at,
    cancellation_reason: b.cancellation_reason,
    has_payment: Boolean(b.stripe_payment_intent_id),
    rooms: b.rooms.map((room) => ({
      room: room.room_name,
      rate_plan: room.rate_plan_name,
      refundable: room.is_refundable,
      cancellation_policy: room.cancellation_policy,
      adults: room.adults,
      children: room.children,
      nights: room.total_nights,
    })),
  };
}

const getBookingArgs = z.object({
  booking_reference: z
    .string()
    .optional()
    .describe("The booking reference: the full UUID or its first 8 characters (with or without #). Omit to list recent bookings."),
});

const bookingRefArgs = z.object({
  booking_reference: z.string().describe("The booking reference: the full UUID or its first 8 characters."),
});

export const HOST_TOOLS = {
  get_booking: {
    description:
      "Look up one of the host's bookings by reference, or omit the reference to list their most recent bookings. Lookups are automatically limited to the properties this host can access. Returns status, dates, guest name, amounts and rooms.",
    schema: getBookingArgs,
    execute: async (args: z.infer<typeof getBookingArgs>, ctx: HostToolContext) => {
      if (!ctx.hostUserId) return NO_VERIFIED_HOST;
      if (args.booking_reference) {
        const match = await findHostBooking(ctx.hostUserId, args.booking_reference);
        if (match.kind === "ambiguous") return AMBIGUOUS_BOOKING;
        return match.kind === "found" ? { found: true, booking: bookingView(match.booking) } : NO_MATCHING_BOOKING;
      }
      const rows = await listHostBookings(ctx.hostUserId);
      return rows.length > 0
        ? { found: true, bookings: rows.map(bookingView) }
        : { found: false, note: "No bookings on this host's properties yet." };
    },
  },
  get_payment_status: {
    description:
      "Look up the guest payment for one of the host's bookings: status, amount and refunds. Identify the booking by reference. This is the guest's payment, not the host's payout.",
    schema: bookingRefArgs,
    execute: async (args: z.infer<typeof bookingRefArgs>, ctx: HostToolContext) => {
      if (!ctx.hostUserId) return NO_VERIFIED_HOST;
      const match = await findHostBooking(ctx.hostUserId, args.booking_reference);
      if (match.kind === "ambiguous") return AMBIGUOUS_BOOKING;
      if (match.kind === "none") return NO_MATCHING_BOOKING;
      const b = match.booking;
      if (!b.stripe_payment_intent_id || !b.stripe_account_id) {
        return { found: false, note: "This booking has no payment on record yet." };
      }
      const summary = await getPaymentSummary(b.stripe_payment_intent_id, b.stripe_account_id);
      return summary ?? { found: false, note: "No payment found for that booking." };
    },
  },
  escalate_to_human: {
    description:
      "Hand the ticket to the OpenBookings support team. Call this when the host asks for a person, when something must be changed or fixed, when money is missing or wrong, or when you cannot answer with your tools. Pass a short reason summarizing what the host needs.",
    schema: escalateArgs,
  },
} satisfies Record<string, ToolDefinition<HostToolContext>>;

export const HOST_AGENT: AgentProfile<HostToolContext> = {
  name: "host",
  systemPrompt: HOST_SYSTEM_PROMPT,
  toolSchemas: () => buildToolSchemas(HOST_TOOLS as Record<string, ToolDefinition<HostToolContext>>),
  executeTool: (name, args, ctx) =>
    runTool(HOST_TOOLS as Record<string, ToolDefinition<HostToolContext>>, name, args, ctx),
};
