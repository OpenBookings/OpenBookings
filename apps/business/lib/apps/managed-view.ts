import type { StatusTone } from "@/components/ui/status-badge";

/**
 * What the console says about a hotel whose rates, availability and
 * restrictions come from SiteMinder. Client-safe: no database imports
 * (managed.ts holds the loaders), so client components can use it.
 */

/** In place of an edit control or a value the hotel no longer sets here. */
export const SET_IN_APP = "Set in SiteMinder";

/** The tooltip on every disabled edit control of a managed hotel. */
export const MANAGED_REASON = "Set in SiteMinder. Rates, availability and restrictions for this hotel come from there.";

/** A managed hotel, as the pages that lock or mark things receive it. */
export type ManagedRooms = {
  /** Rooms SiteMinder has sent no availability for, from today on: not on sale. */
  unlinkedRoomIds: readonly string[];
};

/** Whether a room is not on sale because SiteMinder has not linked it yet. Null: not managed. */
export function isUnlinkedRoom(roomId: string, managed: ManagedRooms | null): boolean {
  return managed !== null && managed.unlinkedRoomIds.includes(roomId);
}

/**
 * When something happened, at the hotel: the time alone when it was today
 * there, else the day and the time ("20 Nov", "09:15").
 */
export function appMoment(iso: string, timeZone: string, now: Date = new Date()): { day: string | null; time: string } {
  const at = new Date(iso);
  const zone = safeZone(timeZone);
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(at);
  if (dayKey.format(at) === dayKey.format(now)) return { day: null, time };
  return { day: new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(at), time };
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export type BookingDelivery = { status: string; acknowledgedAt: string | null };

export type DeliveryBadge = {
  tone: Extract<StatusTone, "positive" | "neutral" | "attention">;
  label: string;
  /** One line under the badge. */
  detail: string;
  /** The one state the hotel must act on: also an Alert at the top of the booking panel. */
  notDelivered: boolean;
};

/**
 * The booking panel's SiteMinder badge, from the app's last report: mint when
 * SiteMinder has it, neutral while it is in hand, amber when the hotel has to
 * act. Null when there is nothing to show.
 */
export function deliveryBadge(
  delivery: BookingDelivery | null,
  timeZone: string,
  now: Date = new Date(),
): DeliveryBadge | null {
  if (!delivery) return null;
  switch (delivery.status) {
    case "delivered": {
      if (!delivery.acknowledgedAt) {
        return { tone: "positive", label: "Sent", detail: "SiteMinder confirmed it.", notDelivered: false };
      }
      const { day, time } = appMoment(delivery.acknowledgedAt, timeZone, now);
      return {
        tone: "positive",
        label: day ? `Sent ${day}, ${time}` : `Sent ${time}`,
        detail: day ? `SiteMinder confirmed it on ${day} at ${time}.` : `SiteMinder confirmed it at ${time} today.`,
        notDelivered: false,
      };
    }
    case "pending":
      return { tone: "neutral", label: "Sending", detail: "This usually takes under a minute.", notDelivered: false };
    case "retrying":
      return {
        tone: "neutral",
        label: "Retrying",
        detail: "SiteMinder didn't answer. We keep trying, so there's nothing to do yet.",
        notDelivered: false,
      };
    case "needs_attention":
      return { tone: "attention", label: "Not delivered", detail: "SiteMinder didn't accept it.", notDelivered: true };
    case "not_sent":
      return {
        tone: "neutral",
        label: "Not sent",
        detail: "Made before you connected. You chose to add these bookings by hand.",
        notDelivered: false,
      };
    default:
      return null;
  }
}
