import { expandNights } from "../metrics";
import { addDays, enumerateDates, weekdayOf } from "../period";
import type { BookingFact, Facts, InventoryFact, IsoDate } from "../types";
import { makeRng, type Rng } from "./rng";
import { ZEEBURG, type DemoHotel, type DemoRatePlan, type DemoRoomType } from "./zeeburg";

/** Arrivals are generated this far past today, so the next 90 days have bookings. */
const HORIZON_DAYS = 180;
/** Mean of STAY_WEIGHTS. Turns nightly demand into arrivals per day. */
const AVERAGE_STAY = 2.77;
const GUEST_POOL = 6000;

const WEEKEND_FACTOR: Record<number, number> = {
  1: 0.82, 2: 0.84, 3: 0.9, 4: 1.0, 5: 1.28, 6: 1.34, 7: 0.92,
};

const SEASON_FACTOR: Record<string, number> = {
  "01": 0.55, "02": 0.6, "03": 0.72, "04": 0.88, "05": 1.0, "06": 1.2,
  "07": 1.38, "08": 1.36, "09": 1.1, "10": 0.9, "11": 0.66, "12": 0.74,
};

const STAY_WEIGHTS: [number, number][] = [
  [1, 22], [2, 34], [3, 20], [4, 10], [5, 6], [6, 3], [7, 3], [9, 2],
];

/** [min days, max days, weight]. */
const LEAD_RANGES: [[number, number], number][] = [
  [[0, 0], 6], [[1, 3], 14], [[4, 7], 16], [[8, 14], 18],
  [[15, 30], 20], [[31, 60], 16], [[61, 150], 10],
];

const ADULT_WEIGHTS: [number, number][] = [[1, 18], [2, 62], [3, 8], [4, 12]];

/** The tail exists so the small-segment fold has something to fold. */
const COUNTRY_WEIGHTS: [string, number][] = [
  ["NL", 38], ["BE", 16], ["DE", 14], ["GB", 8], ["FR", 6], ["US", 4],
  ["IT", 3], ["ES", 3], ["DK", 2], ["SE", 2], ["PL", 1], ["IE", 1],
  ["JP", 1], ["CA", 1], ["AT", 1], ["PT", 1], ["NO", 1], ["CH", 1],
];

const WEEKEND_UPLIFT = 1.15;
const EARLY_BIRD = { minLeadDays: 60, rate: 0.08 };
const LAST_MINUTE = { maxLeadDays: 3, rate: 0.12 };
const WEEKLY = { minNights: 7, rate: 0.1 };

function weighted<T>(rng: Rng, options: [T, number][]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Friday and Saturday nights carry the weekend rate. */
const isWeekendNight = (date: IsoDate): boolean => weekdayOf(date) === 5 || weekdayOf(date) === 6;

function outOfOrder(hotel: DemoHotel, room: DemoRoomType, date: IsoDate): number {
  if (room.units <= 2) return 0;
  return makeRng(`${hotel.seed}:ooo:${room.id}:${date}`).bool(0.03) ? 1 : 0;
}

function countryOf(hotel: DemoHotel, guestIndex: number): string {
  return weighted(makeRng(`${hotel.seed}:guest:${guestIndex}`), COUNTRY_WEIGHTS);
}

/**
 * Bookings first. Each arrival date and rate plan has its own seed, and rooms
 * are allocated in arrival order from the opening day, so the bookings for a
 * given date are the same whatever `today` is: a later today only reveals
 * bookings that had not been made yet.
 */
export function buildDemoFacts(today: IsoDate, hotel: DemoHotel = ZEEBURG): Facts {
  const lastDate = addDays(today, HORIZON_DAYS);
  const dates = enumerateDates(hotel.openedOn, lastDate);
  const rooms = new Map(hotel.roomTypes.map((room) => [room.id, room]));

  const inventory: InventoryFact[] = [];
  const capacity = new Map<string, number>();
  for (const date of dates) {
    for (const room of hotel.roomTypes) {
      const unitsOutOfOrder = outOfOrder(hotel, room, date);
      inventory.push({ date, roomId: room.id, unitsTotal: room.units, unitsOutOfOrder });
      capacity.set(`${room.id}:${date}`, room.units - unitsOutOfOrder);
    }
  }

  const taken = new Map<string, number>();
  const bookings: BookingFact[] = [];

  for (const date of dates) {
    for (const plan of hotel.ratePlans) {
      const room = rooms.get(plan.roomId)!;
      const rng = makeRng(`${hotel.seed}:${plan.id}:${date}`);
      const nightlyDemand =
        room.units * plan.share * hotel.demand *
        (WEEKEND_FACTOR[weekdayOf(date)] ?? 1) * (SEASON_FACTOR[date.slice(5, 7)] ?? 1);
      const expected = nightlyDemand / AVERAGE_STAY;
      const arrivals = Math.floor(expected) + (rng.bool(expected % 1) ? 1 : 0);

      for (let index = 0; index < arrivals; index++) {
        const booking = drawBooking(hotel, plan, date, index, rng, today);
        const stayDates = enumerateDates(date, addDays(date, booking.nights - 1));
        // A stay that runs past the generated window has no capacity row.
        const fits = stayDates.every((d) => (taken.get(`${room.id}:${d}`) ?? 0) < (capacity.get(`${room.id}:${d}`) ?? 0));
        if (!fits) continue;
        for (const d of stayDates) taken.set(`${room.id}:${d}`, (taken.get(`${room.id}:${d}`) ?? 0) + 1);
        // Not made yet, as far as today is concerned. It still holds its room,
        // which is what keeps history identical when today moves.
        if (booking.createdAt.slice(0, 10) > today) continue;
        bookings.push(booking);
      }
    }
  }

  bookings.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  return {
    bookings,
    inventory,
    nights: expandNights(bookings),
    roomTypeNames: Object.fromEntries(hotel.roomTypes.map((room) => [room.id, room.name])),
    ratePlanNames: Object.fromEntries(hotel.ratePlans.map((plan) => [plan.id, plan.name])),
  };
}

/** Every random draw happens here, in a fixed order, whether or not the booking fits. */
function drawBooking(
  hotel: DemoHotel,
  plan: DemoRatePlan,
  checkIn: IsoDate,
  index: number,
  rng: Rng,
  today: IsoDate,
): BookingFact {
  const nights = weighted(rng, STAY_WEIGHTS);
  const [minLead, maxLead] = weighted(rng, LEAD_RANGES);
  const lead = rng.int(minLead, maxLead);
  const createdDate = addDays(checkIn, -lead);
  const createdAt = `${createdDate}T${pad(rng.int(8, 21))}:${pad(rng.int(0, 59))}:00.000Z`;

  const adults = weighted(rng, ADULT_WEIGHTS);
  const children = adults >= 2 && rng.bool(0.2) ? rng.int(1, 2) : 0;
  const guestIndex = rng.int(0, GUEST_POOL - 1);

  const willCancel = rng.bool(plan.refundable ? 0.12 : 0.04);
  const cancelOffset = rng.int(0, lead);
  const cancelDate = addDays(createdDate, cancelOffset);
  const cancelled = willCancel && cancelDate <= today;

  const nightlyBase = Array.from({ length: nights }, (_, i) =>
    isWeekendNight(addDays(checkIn, i)) ? Math.round(plan.barCents * WEEKEND_UPLIFT) : plan.barCents,
  );
  // A discount is earned by the booking itself: how early, how late, how long.
  const discountRate =
    (lead >= EARLY_BIRD.minLeadDays ? EARLY_BIRD.rate : 0) +
    (lead <= LAST_MINUTE.maxLeadDays && plan.refundable ? LAST_MINUTE.rate : 0) +
    (nights >= WEEKLY.minNights ? WEEKLY.rate : 0);
  const nightlyNetCents = nightlyBase.map((cents) => Math.round(cents * (1 - discountRate)));
  const basePriceCents = nightlyBase.reduce((total, cents) => total + cents, 0);
  const netRevenueCents = nightlyNetCents.reduce((total, cents) => total + cents, 0);

  // Non-refundable keeps everything; refundable keeps the first night inside
  // two days of arrival and nothing before that.
  const daysBeforeArrival = lead - cancelOffset;
  const cancellationFeeCents = !cancelled
    ? 0
    : !plan.refundable
      ? netRevenueCents
      : daysBeforeArrival <= 2
        ? nightlyNetCents[0]
        : 0;

  const checkOut = addDays(checkIn, nights);

  return {
    id: `demo-${plan.id}-${checkIn}-${index}`,
    createdAt,
    checkIn,
    checkOut,
    nights,
    status: cancelled ? "cancelled" : checkOut <= today ? "completed" : "confirmed",
    cancelledAt: cancelled ? `${cancelDate}T12:00:00.000Z` : null,
    adults,
    children,
    guestKey: `demo-guest-${guestIndex}`,
    guestCountry: countryOf(hotel, guestIndex),
    roomId: plan.roomId,
    ratePlanId: plan.id,
    nightlyNetCents,
    netRevenueCents,
    basePriceCents,
    discountCents: basePriceCents - netRevenueCents,
    cancellationFeeCents,
  };
}

let cache: { today: IsoDate; facts: Facts } | null = null;

/** One generation per day per server process. */
export function generateDemoFacts(today: IsoDate): Facts {
  if (cache?.today !== today) cache = { today, facts: buildDemoFacts(today) };
  return cache.facts;
}
