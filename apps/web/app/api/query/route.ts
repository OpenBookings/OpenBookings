import {
  getPool,
  loadRoomsAvailability,
  summariseSearchAvailability,
  withTransaction,
} from "@openbookings/db";
import { ensureDemoHotels, hasDemoHotelsNear, isTestingMode } from "@openbookings/demo";
import { freeCancellationUntil, isValidTimeZone, perRoomParty, snapshotTier } from "@openbookings/pricing";
import { getPostHogClient } from "@openbookings/analytics/server";
import { NextRequest, NextResponse } from "next/server";
import { parseStayInput, todayInZone, type StayInput } from "@/lib/booking/stay-input";
import { orderByAvailability, priceCandidates } from "./availability-order";
import { pointBoundErrors } from "./search-bounds";
import { priceSearchStays } from "./search-pricing";
import { loadSearchRows } from "./search-query";
import { resolveSearchTarget } from "./search-target";
import { checkRateLimit, getClientIP } from "@/lib/rateLimit";

type SearchInput = StayInput & {
  lat: number;
  lon: number;
  /** The destination label the guest searched, for naming generated demo hotels. */
  place: string | null;
};

/**
 * Search spans every EU time zone and has no single property's, so "in the
 * past" is judged in the westernmost one: the Azores' today is the earliest
 * today anywhere in the EU, so no guest is refused a stay that starts tonight
 * where they are. The stay quote and booking intents use the property's zone.
 */
const SEARCH_ZONE = "Atlantic/Azores";

/** Parse and validate URL params. Nothing reaches generate_series unless this passes. */
function parseSearchParams(searchParams: URLSearchParams): { input: SearchInput | null; errors: string[] } {
  const errors: string[] = [];
  const coordinate = (name: "lat" | "lon"): number => {
    const v = searchParams.get(name);
    if (v == null || v === "") {
      errors.push(`${name} is required`);
      return NaN;
    }
    const n = Number(v);
    if (Number.isNaN(n)) errors.push(`${name} must be a number`);
    return n;
  };
  const lat = coordinate("lat");
  const lon = coordinate("lon");
  if (errors.length === 0) errors.push(...pointBoundErrors({ lat, lon }));

  const stay = parseStayInput(searchParams, todayInZone(SEARCH_ZONE));
  if (!stay.ok) errors.push(...stay.errors);
  if (errors.length > 0 || !stay.ok) return { input: null, errors };

  const place = searchParams.get("place")?.trim().slice(0, 200) || null;
  return { input: { ...stay.value, lat, lon, place }, errors };
}

/**
 * Testing mode: the first search near a point creates the eight demo hotels
 * there. Steady state is one indexed query; the generator's transaction and
 * lock only run for a new area. A failure is logged and the search goes on.
 */
/** New demo areas one caller may create per hour. Searching existing areas is not limited. */
const DEMO_AREAS_PER_IP_PER_HOUR = 5

async function ensureDemoArea(
  i: { lat: number; lon: number; place: string | null },
  request: NextRequest,
): Promise<void> {
  try {
    if (await hasDemoHotelsNear(getPool(), i)) return;
    // Searches are anonymous: without this, one caller walking the map makes
    // eight demo hotels at every stop.
    if (!checkRateLimit(`demo-area:ip:${getClientIP(request)}`, DEMO_AREAS_PER_IP_PER_HOUR, 60 * 60 * 1000).allowed) return;
    await withTransaction((tx) => ensureDemoHotels(tx, i));
  } catch (err) {
    console.error("[search] demo hotels:", err instanceof Error ? err.message : err);
  }
}

async function runSearch(input: SearchInput, testing: boolean) {
  const roomRows = await loadSearchRows(getPool(), { ...input, testing })
  if (roomRows.length === 0) return []

  const now = new Date()
  const propertyIds = [...new Set(roomRows.map(row => row.hotel_id))]
  const rooms = await loadRoomsAvailability(getPool(), {
    propertyIds,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    now,
  })
  const availability = summariseSearchAvailability(rooms, { propertyIds, ...input })
  // A room qualifies when it takes the largest share of the party; the card
  // is priced for all the rooms searched, each with its own share.
  const party = perRoomParty(input)

  const results = priceSearchStays(priceCandidates(roomRows, rooms, availability, party), {
    adults: input.adults,
    children: input.children,
    infants: input.infants,
    rooms: input.rooms,
    arrivalDate: input.checkIn,
  }).map(result => {
    // A stored timezone is not trusted: a bad one must not fail the whole search.
    const zoneOk = !result.timezone || isValidTimeZone(result.timezone)
    if (!zoneOk) console.error("[search] bad property timezone", result.hotel_id)
    const until =
      zoneOk && result.cancellation_tier && result.timezone
        ? freeCancellationUntil({
            tier: snapshotTier(result.cancellation_tier, result.is_refundable),
            timeZone: result.timezone,
            checkInTime: result.check_in_time ?? null,
            arrivalDate: input.checkIn,
            now,
          })
        : null
    const a = availability.get(result.hotel_id)
    return {
      ...result,
      free_cancellation_until: until ? until.toISOString() : null,
      availability: { bookable: a?.bookable ?? false, reason: a?.reason ?? null },
    }
  })
  return orderByAvailability(results, { testing })
}

/** Analytics properties, under the names the search events have always used. */
function searchProperties(i: SearchInput) {
  return {
    lat: i.lat,
    lon: i.lon,
    checkin: i.checkIn,
    checkout: i.checkOut,
    adults: i.adults,
    children: i.children,
    infants: i.infants,
    rooms: i.rooms,
  }
}

export async function GET(request: NextRequest) {
  const target = await resolveSearchTarget(request.nextUrl.searchParams)
  if (!target.ok) {
    return NextResponse.json({ errors: target.errors }, { status: 400 })
  }
  const searchParams = new URLSearchParams(request.nextUrl.searchParams)
  if (target.lat != null) searchParams.set("lat", target.lat)
  if (target.lon != null) searchParams.set("lon", target.lon)
  if (target.place) searchParams.set("place", target.place)
  const { input, errors } = parseSearchParams(searchParams)
  const distinctId = request.headers.get("x-posthog-distinct-id") ?? "anonymous"

  if (!input) {
    return NextResponse.json({ errors }, { status: 400 })
  }

  const testing = isTestingMode()
  if (testing) await ensureDemoArea(input, request)

  let results
  try {
    results = await runSearch(input, testing)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error"

    // The detail goes to our own telemetry and logs. It does not go to the
    // caller: a Postgres error text names tables, columns and constraints,
    // which hands an unauthenticated client a free schema dump and turns a
    // malformed-input probe into a discovery tool.
    console.error("[search]", message)

    const posthog = getPostHogClient()
    posthog.capture({
      distinctId,
      event: "hotel_search_failed",
      properties: {
        error_message: message,
        ...searchProperties(input),
      },
    })
    await posthog.shutdown()

    return NextResponse.json({ error: "Search is unavailable right now" }, { status: 500 })
  }

  const posthog = getPostHogClient()
  posthog.capture({
    distinctId,
    event: "hotel_search_completed",
    properties: {
      result_count: results.length,
      ...searchProperties(input),
    },
  })
  await posthog.shutdown()

  return NextResponse.json(results)
}