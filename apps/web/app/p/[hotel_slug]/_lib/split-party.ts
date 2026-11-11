import type { SelectedRoom } from "@/lib/booking/quote";
import { MAX_INFANTS_PER_ROOM } from "@/lib/booking/stay-input";

/** One room picked: which room and rate, how many it sleeps, and the cots and extra beds asked for. */
export type Unit = {
  roomId: string;
  ratePlanId: string;
  maxAdults: number;
  maxChildren: number;
  cots?: number;
  extraBeds?: number;
};

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
 * double still take 3 adults. Infants take no place, so they are dealt last,
 * up to MAX_INFANTS_PER_ROOM a room whatever its size.
 */
export function splitParty(
  party: { adults: number; children: number; infants?: number },
  units: Unit[],
): SplitResult {
  const { adults, children, infants = 0 } = party;
  if (units.length === 0) return { ok: false, reason: "too_few_rooms" };
  if (units.length > adults) return { ok: false, reason: "too_many_rooms" };

  const a = units.map(() => 1);
  const c = units.map(() => 0);
  const adultsLeft = deal(adults - units.length, a, units.map((u) => Math.max(1, u.maxAdults)));
  const childrenLeft = deal(children, c, units.map((u) => u.maxChildren));
  const inf = units.map(() => 0);
  const infantsLeft = deal(infants, inf, units.map(() => MAX_INFANTS_PER_ROOM));
  const tooSmall = adultsLeft > 0 || childrenLeft > 0 || infantsLeft > 0 || units.some((u, i) => a[i] > u.maxAdults);
  if (tooSmall) {
    return units.length === 1
      ? { ok: false, reason: "does_not_fit", roomId: units[0].roomId }
      : { ok: false, reason: "too_few_rooms" };
  }

  return {
    ok: true,
    rooms: units.map((u, i) => ({
      roomId: u.roomId,
      ratePlanId: u.ratePlanId,
      adults: a[i],
      children: c[i],
      infants: inf[i],
      cots: u.cots ?? 0,
      extraBeds: u.extraBeds ?? 0,
    })),
  };
}
