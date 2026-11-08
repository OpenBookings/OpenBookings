import type { SelectedRoom } from "@/lib/booking/quote";

/** One room picked: which room and rate, and how many it sleeps. */
export type Unit = { roomId: string; ratePlanId: string; maxAdults: number; maxChildren: number };

export type SplitResult =
  | { ok: true; rooms: SelectedRoom[] }
  | { ok: false; reason: "too_few_rooms" | "too_many_rooms" | "does_not_fit"; roomId?: string };

/**
 * Deals `count` guests round-robin over the units, first unit first, passing
 * over a unit once it is full. Returns how many could not be placed.
 */
function deal(count: number, into: number[], max: number[]): number {
  let left = count;
  while (left > 0) {
    let placed = false;
    for (let i = 0; i < into.length && left > 0; i++) {
      if (into[i] >= max[i]) continue;
      into[i] += 1;
      left -= 1;
      placed = true;
    }
    if (!placed) break;
  }
  return left;
}

/**
 * The party split evenly over the picked rooms (owner decision): adults
 * first, the first room taking any extra, then children the same way. Every
 * room needs an adult. A room that is full is passed over, so a single and a
 * double still take 3 adults.
 */
export function splitParty(adults: number, children: number, units: Unit[]): SplitResult {
  if (units.length === 0) return { ok: false, reason: "too_few_rooms" };
  if (units.length > adults) return { ok: false, reason: "too_many_rooms" };

  const a = units.map(() => 1);
  const c = units.map(() => 0);
  const adultsLeft = deal(adults - units.length, a, units.map((u) => Math.max(1, u.maxAdults)));
  const childrenLeft = deal(children, c, units.map((u) => u.maxChildren));
  const tooSmall = adultsLeft > 0 || childrenLeft > 0 || units.some((u, i) => a[i] > u.maxAdults);
  if (tooSmall) {
    return units.length === 1
      ? { ok: false, reason: "does_not_fit", roomId: units[0].roomId }
      : { ok: false, reason: "too_few_rooms" };
  }

  return {
    ok: true,
    rooms: units.map((u, i) => ({ roomId: u.roomId, ratePlanId: u.ratePlanId, adults: a[i], children: c[i] })),
  };
}
