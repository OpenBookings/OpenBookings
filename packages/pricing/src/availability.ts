/**
 * The single availability rule. Search, the stay quote, booking intents,
 * payment confirmation and the host rates grid all decide "can this be
 * booked" through these pure functions. Dates are YYYY-MM-DD strings.
 */

export type UnavailableReason =
  | 'sold_out'
  | 'room_closed'
  | 'rate_closed'
  | 'closed_to_arrival'
  | 'closed_to_departure'
  | 'min_stay'
  | 'max_stay'
  | 'too_many_guests'
  | 'not_on_sale'

/** Priority used when one reason must represent a hotel; first wins. */
export const REASON_PRIORITY: readonly UnavailableReason[] = [
  'sold_out',
  'room_closed',
  'rate_closed',
  'closed_to_arrival',
  'closed_to_departure',
  'min_stay',
  'max_stay',
  'too_many_guests',
  'not_on_sale',
]

/**
 * Units a room type has on one night. An availability override replaces the
 * count outright (blocked units are not subtracted from it); otherwise the
 * night's total rooms (or the room type's units) minus blocked units.
 */
export function nightTotal(i: {
  override: number | null
  totalRooms: number | null
  totalUnits: number
  blocked: number
}): number {
  if (i.override !== null) return Math.max(0, i.override)
  return Math.max(0, (i.totalRooms ?? i.totalUnits) - i.blocked)
}

export function bookableUnits(i: { total: number; booked: number; held: number }): number {
  return Math.max(0, i.total - i.booked - i.held)
}

export type StayRule = {
  date: string
  isClosed: boolean
  minStay: number | null
  maxStay: number | null
  closedToArrival: boolean
  closedToDeparture: boolean
}

const DAY_MS = 86_400_000

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
}

/** Rate-plan restrictions a stay breaks, in REASON_PRIORITY order. */
export function stayRuleReasons(i: {
  checkIn: string
  checkOut: string
  planMinStay: number | null
  planMaxStay: number | null
  rules: StayRule[]
}): UnavailableReason[] {
  const from = dayNumber(i.checkIn)
  const to = dayNumber(i.checkOut)
  const nights = to - from
  const arrival = i.rules.find(r => r.date === i.checkIn)
  const departure = i.rules.find(r => r.date === i.checkOut)

  const found = new Set<UnavailableReason>()
  if (i.rules.some(r => r.isClosed && dayNumber(r.date) >= from && dayNumber(r.date) < to)) {
    found.add('rate_closed')
  }
  if (arrival?.closedToArrival) found.add('closed_to_arrival')
  if (departure?.closedToDeparture) found.add('closed_to_departure')

  const minStay = arrival?.minStay ?? i.planMinStay
  const maxStay = arrival?.maxStay ?? i.planMaxStay
  if (minStay !== null && nights < minStay) found.add('min_stay')
  if (maxStay !== null && nights > maxStay) found.add('max_stay')

  return REASON_PRIORITY.filter(r => found.has(r))
}

/** The party one room has to hold when a booking spreads over several rooms. */
export function perRoomParty(i: { adults: number; children: number; infants?: number; rooms: number }): {
  adults: number
  children: number
  infants: number
} {
  const rooms = Math.max(1, i.rooms)
  return {
    adults: Math.ceil(i.adults / rooms),
    children: Math.ceil(i.children / rooms),
    infants: Math.ceil((i.infants ?? 0) / rooms),
  }
}

/** The highest-priority reason among those given, or null. */
export function pickReason(reasons: Iterable<UnavailableReason>): UnavailableReason | null {
  const set = new Set(reasons)
  return REASON_PRIORITY.find(r => set.has(r)) ?? null
}
