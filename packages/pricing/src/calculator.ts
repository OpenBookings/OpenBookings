import type { PropertyCancellationTier } from './cancellation'
import { calculateTouristTax, type TouristTaxResult, type TouristTaxRule } from "./tourist-tax";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type AdjustmentType = 'flat' | 'percent'

export type ModifierType =
  | 'day_of_week'
  | 'length_of_stay'
  | 'early_bird'
  | 'last_minute'
  | 'extra_guest'

export interface Night {
  date: string        // "2026-07-01"
  base_price: number
  has_override: boolean
}

interface NightWithSurcharge extends Night {
  /** Rate modifiers' surcharges on this night. Stay discounts are spread over these. */
  _surcharge: number
  /** Extra guests, cots and extra beds on this night. Never discounted. */
  _extra: number
}

export interface Modifier {
  type: ModifierType
  adjustment_type: AdjustmentType
  adjustment_value: number
  trigger_condition: Record<string, unknown>
  sort_order: number
}

export interface RoomRow {
  hotel_id: string
  hotel_name: string
  hotel_slug: string
  city: string
  country: string
  hero_image_url: string | null
  /** Metres from the searched point. Set by the search query. */
  distance_m?: number
  room_id: string
  room_name: string
  room_description: string
  base_occupancy: number
  max_adults: number
  max_children: number
  rate_plan_id: string
  rate_plan_name: string
  currency: string
  is_refundable: boolean
  /** The property's base cancellation tier and arrival details, for the free-cancellation tag. */
  cancellation_tier?: PropertyCancellationTier
  timezone?: string
  check_in_time?: string
  min_stay: number
  max_stay: number | null
  nights: Night[]
  modifiers: Modifier[]
  /** The property's tourist tax rules. Absent or empty = no tourist tax. */
  tourist_tax_rules?: TouristTaxRule[]
  /**
   * Per extra guest per night, whole euros. Guests above `base_occupancy`
   * pay it (see `extraGuests`). Absent or null = not charged.
   */
  extra_adult_fee?: number | null
  extra_child_fee?: number | null
  /** Per cot / extra bed per night, whole euros. 0 = free. */
  cot_fee?: number | null
  extra_bed_fee?: number | null
}

interface SearchParams {
  adults: number
  children: number
  arrivalDate: string
  /** Cots and extra beds booked with the room. Checked against the room's limits by the caller. */
  cots?: number
  extraBeds?: number
}

/**
 * How many of the party are above the room's base occupancy. Adults fill the
 * included places first, so a family of two adults and a child in a room for
 * two has one extra child.
 */
export function extraGuests(
  baseOccupancy: number,
  adults: number,
  children: number
): { adults: number; children: number } {
  const extraAdults = Math.max(0, adults - baseOccupancy)
  const placesLeft = Math.max(0, baseOccupancy - adults)
  return { adults: extraAdults, children: Math.max(0, children - placesLeft) }
}

// ─────────────────────────────────────────────
// Modifier eligibility
// ─────────────────────────────────────────────

function isEligible(
  modifier: Modifier,
  context: {
    date: string
    numNights: number
    arrivalDate: string
    today: string
  }
): boolean {
  const { type, trigger_condition: tc } = modifier
  const { date, numNights, arrivalDate, today } = context

  const daysUntilArrival =
    (new Date(arrivalDate).getTime() - new Date(today).getTime()) / 86_400_000

  switch (type) {
    case 'day_of_week': {
      const dow = new Date(date).getDay()
      return (tc.days_of_week as number[]).includes(dow)
    }

    case 'length_of_stay': {
      return numNights >= (tc.min_nights as number)
    }

    case 'early_bird': {
      return daysUntilArrival >= (tc.days_before_arrival as number)
    }

    case 'last_minute': {
      return daysUntilArrival <= (tc.days_till_arrival as number)
    }

    default:
      return false
  }
}

// ─────────────────────────────────────────────
// Calculation context (threaded through each step)
// ─────────────────────────────────────────────

/**
 * One line of the price build-up, in the order it was applied.
 *
 * The ARI grid's detail panel renders these directly, so the contract is that
 * the steps reconstruct the price rather than merely describe it: every step's
 * `delta` is its contribution to the running total, and the last step's
 * `result` is the resolved price. A host who adds the column up must land on
 * the number in the cell, or the panel is not an explanation.
 *
 * Amounts are whole currency units, matching `bar` and `price_per_night`.
 */
export interface PriceStep {
  /** 'Base rate', 'Rate override', 'Day of week'... */
  label: string
  /**
   * `base` and `set` establish the starting figure — `set` meaning a
   * rate_overrides row replaced the plan's BAR. `percent` and `flat` are the
   * two ways a modifier adjusts it.
   */
  op: 'base' | 'set' | 'percent' | 'flat' | 'extra'
  /** The figure behind the op: the amount itself, or the modifier's adjustment_value. */
  value: number
  /** Signed contribution to the running total. */
  delta: number
  /** Running total after this step. */
  result: number
  /** Absent on base and override steps. */
  modifier_type?: ModifierType
}

interface CalculationState {
  nights: NightWithSurcharge[]
  subtotal: number
  total: number
  applied: Set<ModifierType>
  /** Built as the executor runs. Modifiers that never fire leave no step. */
  trace: PriceStep[]
}

/**
 * Append a step for a modifier that fired, deriving its running total from
 * what came before.
 *
 * A modifier that was eligible but moved the total by nothing — a weekend
 * surcharge on a midweek-only window — leaves no step. It is still reported in
 * `applied_modifiers`, which answers "did this rule match"; the trace answers
 * "what made this price", and a "+€0" line answers neither.
 */
function traceModifier(
  state: CalculationState,
  label: string,
  modifier: Modifier,
  delta: number,
): PriceStep[] {
  if (delta === 0) return state.trace
  const previous = state.trace[state.trace.length - 1]?.result ?? 0
  return [
    ...state.trace,
    {
      label,
      op: modifier.adjustment_type === 'percent' ? 'percent' : 'flat',
      value: modifier.adjustment_value,
      delta,
      result: previous + delta,
      modifier_type: modifier.type,
    },
  ]
}

/**
 * The starting figure, split by where it came from.
 *
 * One step in the ordinary case. A window that mixes overridden and
 * un-overridden nights gets two, because collapsing them would report a stay
 * as entirely on the BAR or entirely on an override when it is neither — and
 * which nights a host has repriced is the thing they opened the panel to see.
 */
function baseSteps(nights: Night[]): PriceStep[] {
  const overridden = nights.filter(n => n.has_override)
  const standard = nights.filter(n => !n.has_override)

  const steps: PriceStep[] = []
  let running = 0

  const push = (label: string, op: 'base' | 'set', rows: Night[]) => {
    if (rows.length === 0) return
    const amount = rows.reduce((sum, n) => sum + n.base_price, 0)
    running += amount
    steps.push({ label, op, value: amount, delta: amount, result: running })
  }

  push('Base rate', 'base', standard)
  push('Rate override', 'set', overridden)

  // Every night overridden, or none: either way a single step, and the label
  // already says which.
  return steps
}

/**
 * Round for display *and* keep the column addable.
 *
 * Rounding each step independently lets a half-cent in two steps show a total
 * a cent off the sum of what is printed above it. Rounding the running totals
 * and re-deriving each delta from them cannot: the deltas are then differences
 * between the numbers actually on screen.
 */
function roundTrace(trace: PriceStep[]): PriceStep[] {
  let previous = 0
  return trace.map(step => {
    const result = round2(step.result)
    const rounded = { ...step, value: round2(step.value), delta: round2(result - previous), result }
    previous = result
    return rounded
  })
}

interface ModifierContext {
  numNights: number
  arrivalDate: string
  today: string
}

type ModifierStepFn = (
  state: CalculationState,
  modifier: Modifier,
  context: ModifierContext
) => CalculationState

// ─────────────────────────────────────────────
// Step functions (ordered by sort_order)
// ─────────────────────────────────────────────

function applyDayOfWeek(
  state: CalculationState,
  modifier: Modifier,
  context: ModifierContext
): CalculationState {
  if (modifier.type !== 'day_of_week') return state

  const updatedNights = state.nights.map(night => {
    const nightContext = { ...context, date: night.date }
    if (!isEligible(modifier, nightContext)) return night

    const surcharge = modifier.adjustment_type === 'flat'
      ? modifier.adjustment_value
      : (night.base_price * modifier.adjustment_value) / 100

    return {
      ...night,
      _surcharge: night._surcharge + surcharge,
    }
  })

  const totalSurcharge = updatedNights.reduce((sum, n) => sum + n._surcharge, 0)
    - state.nights.reduce((sum, n) => sum + n._surcharge, 0)

  return {
    ...state,
    nights: updatedNights,
    subtotal: state.subtotal + totalSurcharge,
    total: state.total + totalSurcharge,
    applied: new Set([...state.applied, 'day_of_week']),
    trace: traceModifier(state, 'Day of week', modifier, totalSurcharge),
  }
}

function applyLastMinute(
  state: CalculationState,
  modifier: Modifier,
  context: ModifierContext
): CalculationState {
  if (modifier.type !== 'last_minute') return state

  const dummyContext = { ...context, date: context.arrivalDate }
  if (!isEligible(modifier, dummyContext)) return state

  // Apply surcharge to each night
  const updatedNights = state.nights.map(night => {
    const surcharge = modifier.adjustment_type === 'flat'
      ? modifier.adjustment_value
      : (night.base_price * modifier.adjustment_value) / 100

    return {
      ...night,
      _surcharge: night._surcharge + surcharge,
    }
  })

  const totalSurcharge = updatedNights.reduce((sum, n) => sum + n._surcharge, 0)
    - state.nights.reduce((sum, n) => sum + n._surcharge, 0)

  return {
    ...state,
    nights: updatedNights,
    subtotal: state.subtotal + totalSurcharge,
    total: state.total + totalSurcharge,
    applied: new Set([...state.applied, 'last_minute']),
    trace: traceModifier(state, 'Last minute', modifier, totalSurcharge),
  }
}

function applyLengthOfStay(
  state: CalculationState,
  modifier: Modifier,
  context: ModifierContext
): CalculationState {
  if (modifier.type !== 'length_of_stay') return state

  const dummyContext = { ...context, date: context.arrivalDate }
  if (!isEligible(modifier, dummyContext)) return state

  const discount = modifier.adjustment_type === 'flat'
    ? modifier.adjustment_value
    : (state.subtotal * modifier.adjustment_value) / 100

  return {
    ...state,
    total: state.total + discount,
    applied: new Set([...state.applied, 'length_of_stay']),
    trace: traceModifier(state, 'Length of stay', modifier, discount),
  }
}

function applyEarlyBird(
  state: CalculationState,
  modifier: Modifier,
  context: ModifierContext
): CalculationState {
  if (modifier.type !== 'early_bird') return state

  const dummyContext = { ...context, date: context.arrivalDate }
  if (!isEligible(modifier, dummyContext)) return state

  const discount = modifier.adjustment_type === 'flat'
    ? modifier.adjustment_value
    : (state.subtotal * modifier.adjustment_value) / 100

  return {
    ...state,
    total: state.total + discount,
    applied: new Set([...state.applied, 'early_bird']),
    trace: traceModifier(state, 'Early bird', modifier, discount),
  }
}

// ─────────────────────────────────────────────
// Executor: run all modifiers in sort_order
// ─────────────────────────────────────────────

function executeModifiers(
  nights: Night[],
  modifiers: Modifier[],
  context: ModifierContext
): CalculationState {
  // Initial subtotal: sum of base prices
  const initialSubtotal = nights.reduce((sum, n) => sum + n.base_price, 0)

  let state: CalculationState = {
    nights: nights.map(n => ({ ...n, _surcharge: 0, _extra: 0 })),
    subtotal: initialSubtotal,
    total: initialSubtotal,
    applied: new Set(),
    trace: baseSteps(nights),
  }

  // Sort by sort_order and execute each modifier
  const sortedModifiers = [...modifiers].sort((a, b) => a.sort_order - b.sort_order)

  // Only one discount may fire — the eligible one with the lowest sort_order
  const DISCOUNT_TYPES = new Set<ModifierType>(['length_of_stay', 'early_bird'])

  // `extra_guest` rows are no longer a rate rule: extra guests are priced from
  // the room (applyOccupancyAndExtras), so such a row is skipped.
  const stepFunctions: Partial<Record<ModifierType, ModifierStepFn>> = {
    day_of_week: applyDayOfWeek,
    last_minute: applyLastMinute,
    length_of_stay: applyLengthOfStay,
    early_bird: applyEarlyBird,
  }

  for (const modifier of sortedModifiers) {
    // Skip discount modifiers once one has already been applied
    if (DISCOUNT_TYPES.has(modifier.type) && [...state.applied].some(t => DISCOUNT_TYPES.has(t))) {
      continue
    }

    const stepFn = stepFunctions[modifier.type]
    if (stepFn) {
      state = stepFn(state, modifier, context)
    }
  }

  return state
}

// ─────────────────────────────────────────────
// Main resolver
// ─────────────────────────────────────────────

export interface ResolvedRoom
  extends Omit<RoomRow, 'nights' | 'modifiers' | 'tourist_tax_rules'> {
  nights: Night[]
  modifiers: Modifier[]
  subtotal: number
  /**
   * The room price after modifiers: the host's rate, incl. VAT, excl. tourist
   * tax. OpenBookings' commission is taken on this.
   */
  room_price: number
  /** Worked out from the property's rules, on top of `room_price`. */
  tourist_tax: TouristTaxResult
  /**
   * What the guest pays, all-in: `room_price` plus `tourist_tax.total`. Rates
   * include VAT by contract with the host, so nothing else is added.
   */
  total_price: number
  /**
   * What each night cost after modifiers, each rounded to cents. The last
   * night absorbs rounding so the nights sum to `room_price` exactly.
   */
  priced_nights: { date: string; price: number }[]
  applied_modifiers: ModifierType[]
  /** Ordered build-up of `total_price`. See PriceStep. */
  trace: PriceStep[]
}

export function resolveRoom(
  row: RoomRow,
  params: SearchParams,
  today: string = new Date().toISOString().split('T')[0]
): ResolvedRoom {
  const { adults, children, arrivalDate } = params
  const numNights = row.nights.length

  const state = applyOccupancyAndExtras(
    executeModifiers(row.nights, row.modifiers, { numNights, arrivalDate, today }),
    row,
    params,
  )

  const roomPrice = round2(state.total)
  const touristTax = calculateTouristTax(row.tourist_tax_rules ?? [], {
    nights: pricedNights(state),
    adults,
    children,
    rooms: 1,
  })

  const { tourist_tax_rules: _rules, ...rest } = row
  return {
    ...rest,
    nights: row.nights, // return original nights (drop _surcharge)
    modifiers: row.modifiers,
    subtotal: round2(state.subtotal + extrasTotal(state)),
    room_price: roomPrice,
    tourist_tax: touristTax,
    total_price: round2(roomPrice + touristTax.total),
    priced_nights: roundedPricedNights(pricedNights(state), roomPrice),
    applied_modifiers: [...state.applied],
    trace: roundTrace(state.trace),
  }
}

// ─────────────────────────────────────────────
// Occupancy & extras (after the rate modifiers, never discounted)
// ─────────────────────────────────────────────

const extrasTotal = (state: CalculationState) => state.nights.reduce((sum, n) => sum + n._extra, 0)

/**
 * Add what the room charges on top of its rate: guests above base occupancy,
 * cots and extra beds, each per night. Runs after every rate modifier, so no
 * discount reaches these fees. One trace line per fee that adds something.
 */
function applyOccupancyAndExtras(
  state: CalculationState,
  row: RoomRow,
  params: SearchParams
): CalculationState {
  const extra = extraGuests(row.base_occupancy, params.adults, params.children)
  const lines: { label: string; fee: number | null | undefined; count: number }[] = [
    { label: 'Extra adults', fee: row.extra_adult_fee, count: extra.adults },
    { label: 'Extra children', fee: row.extra_child_fee, count: extra.children },
    { label: 'Cots', fee: row.cot_fee, count: params.cots ?? 0 },
    { label: 'Extra beds', fee: row.extra_bed_fee, count: params.extraBeds ?? 0 },
  ]

  let next = state
  for (const { label, fee, count } of lines) {
    const perNight = (fee ?? 0) * count
    if (perNight <= 0) continue
    const delta = perNight * next.nights.length
    const previous = next.trace[next.trace.length - 1]?.result ?? 0
    next = {
      ...next,
      nights: next.nights.map(n => ({ ...n, _extra: n._extra + perNight })),
      total: next.total + delta,
      trace: [...next.trace, { label, op: 'extra', value: fee ?? 0, delta, result: previous + delta }],
    }
  }
  return next
}

/**
 * What each night actually cost, for a tourist tax percentage.
 *
 * Surcharges are per night, but a stay discount (length of stay, early bird)
 * comes off the total. Spreading the discount over the nights in proportion
 * keeps every night's share honest and makes the nights add up to the total.
 * Extras are never discounted, so each night carries its own in full.
 */
function pricedNights(state: CalculationState): { date: string; price: number }[] {
  const discounted = state.total - extrasTotal(state)
  const scale = state.subtotal > 0 ? discounted / state.subtotal : 0
  return state.nights.map(n => ({ date: n.date, price: (n.base_price + n._surcharge) * scale + n._extra }))
}

function roundedPricedNights(
  nights: { date: string; price: number }[],
  roomPrice: number
): { date: string; price: number }[] {
  const rounded = nights.map(n => ({ date: n.date, price: round2(n.price) }))
  if (rounded.length === 0) return rounded
  const head = rounded.slice(0, -1).reduce((sum, n) => sum + n.price, 0)
  rounded[rounded.length - 1].price = round2(roomPrice - head)
  return rounded
}

// ─────────────────────────────────────────────
// Per-night resolution (host ARI grid)
// ─────────────────────────────────────────────

export interface NightlyRate extends Night {
  /** Nights actually priced for this cell — `stayLength`, or fewer at the tail. */
  stay_length: number
  /** Total for the whole probe stay. */
  total: number
  /** Per-night average across the probe. This is what a grid cell displays. */
  price: number
  applied_modifiers: ModifierType[]
  /**
   * Ordered build-up of `total`, the probe stay's total — not of `price`.
   * At the default stay length of 1 the two are the same number; above it the
   * detail panel divides the last step by `stay_length` to reach the per-night
   * figure, and says so.
   */
  trace: PriceStep[]
}

/** Modifiers that only ever fire on a multi-night stay. */
const STAY_LENGTH_TYPES = new Set<ModifierType>(['length_of_stay'])

/** True when the plan carries a discount a longer stay would unlock. */
export function hasStayLengthDiscount(modifiers: Modifier[]): boolean {
  return modifiers.some(m => STAY_LENGTH_TYPES.has(m.type))
}

/**
 * Resolve one price per date, for the host-facing ARI grid.
 *
 * A grid cell is a different question from a search result: search prices a
 * whole stay, a cell prices *a stay of `stayLength` nights arriving on that
 * date, at base occupancy*, shown as a per-night average. Framing it that way
 * means each cell is just a stay run through the same executor the
 * guest-facing search uses — so the grid cannot drift from what guests are
 * quoted.
 *
 * `stayLength` defaults to 1, the extranet convention. Raising it lets a host
 * see the rates a longer booking would actually get, because stay-length
 * discounts (`length_of_stay`, and any `early_bird` gated on nights) only fire
 * once the probe is long enough to qualify. Extra-guest fees, cots and extra
 * beds never appear here — the probe is at base occupancy with no extras, and
 * those are booking properties rather than date ones. Date-intrinsic modifiers (`day_of_week`, `last_minute`,
 * lead-time `early_bird`) resolve normally at any stay length, since the
 * cell's date is the arrival date.
 *
 * Callers wanting a full-length probe for every visible date must pass nights
 * extending `stayLength - 1` days past the last visible date; the tail is
 * priced on whatever nights it has rather than dropped.
 */
export function resolveNightlyRates(
  nights: Night[],
  modifiers: Modifier[],
  options: { baseOccupancy: number; stayLength?: number; today?: string }
): NightlyRate[] {
  const today = options.today ?? new Date().toISOString().split('T')[0]
  const stayLength = Math.max(1, Math.floor(options.stayLength ?? 1))

  return nights.map((night, index) => {
    const window = nights.slice(index, index + stayLength)
    const numNights = window.length

    const state = executeModifiers(window, modifiers, {
      numNights,
      arrivalDate: night.date,
      today,
    })

    return {
      ...night,
      stay_length: numNights,
      total: round2(state.total),
      price: round2(state.total / numNights),
      applied_modifiers: [...state.applied],
      trace: roundTrace(state.trace),
    }
  })
}

export function resolveSearchResults(
  rows: RoomRow[],
  params: SearchParams,
  today?: string
): ResolvedRoom[] {
  const resolved = rows.map(row => resolveRoom(row, params, today))
  const byHotel = new Map<string, ResolvedRoom>()

  for (const room of resolved) {
    const existing = byHotel.get(room.hotel_id)
    if (!existing || room.total_price < existing.total_price) {
      byHotel.set(room.hotel_id, room)
    }
  }

  return [...byHotel.values()].sort((a, b) => a.total_price - b.total_price)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}