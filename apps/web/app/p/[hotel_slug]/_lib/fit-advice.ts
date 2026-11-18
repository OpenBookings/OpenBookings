import type { QuotedRoom } from "@/lib/booking/quote";
import { fewestRoomsThatFit } from "@/components/plug-in/guest-limits";

/**
 * Why no room shows for the stay, when it is the party's size: `more_rooms`
 * names the fewest rooms it fits in here, `too_big` means no number of rooms
 * does. Null when the rooms are hidden for anything else (sold out, closed,
 * minimum stay), which is about the dates.
 */
export type FitAdvice = { kind: "more_rooms"; rooms: number } | { kind: "too_big" };

export function fitAdvice(
  quoted: Pick<QuotedRoom, "maxAdults" | "maxChildren" | "unitsLeft" | "reasons" | "ratePlans">[],
  party: { adults: number; children: number; rooms: number },
): FitAdvice | null {
  // Rooms that are only too small for the party's share: on sale, with units
  // left, and a rate open for these dates.
  const tooSmall = quoted.filter(
    (q) =>
      q.reasons.length > 0 &&
      q.reasons.every((r) => r === "too_many_guests") &&
      q.ratePlans.some((p) => p.reasons.length === 0),
  );
  if (tooSmall.length === 0) return null;
  const rooms = fewestRoomsThatFit(party, tooSmall);
  return rooms !== null && rooms > party.rooms ? { kind: "more_rooms", rooms } : { kind: "too_big" };
}
