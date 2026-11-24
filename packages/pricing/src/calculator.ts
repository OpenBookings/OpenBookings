import type { PropertyCancellationTier } from './cancellation'
import { percentOfCents, roundHalfUp } from './money'
import { calculateTouristTax, type TouristTaxResult, type TouristTaxRule } from "./tourist-tax";

/*
 * Every amount in this module is an integer number of cents. A percentage is
 * applied per night and rounded half up to a whole cent (money.ts), so each
 * night is whole cents and the nights always sum exactly to the totals.
 */

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
  /** The plan's BAR (`rate_plans.bar_cents`) or the override (`price_per_night_cents`). */
  base_price_cents: number
  has_override: boolean
  /**
   * On a rate plan a connected app manages (`RoomRow.managed`): the app's fee
   * per extra adult / child for this night, in cents. Null or absent = no fee.
   * Ignored on other plans, which take the room's fees.
   */
  extra_adult_fee_cents?: number | null
  extra_child_fee_cents?: number | null
}

interface NightWithSurcharge extends Night {
  /** Rate modifiers' surcharges on this night, in cents. */
  _surcharge: number
  /** The stay discount's share of this night, in cents (zero or negative). */
  _discount: number
  /** Extra adults and children on this night, in cents. Never discounted. */
  _extra: number
}

export interface Modifier {
  type: ModifierType
  adjustment_type: AdjustmentType
  /** A percentage for `percent` rules (-10 = 10% off); cents per night for `flat` ones. */
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
   * Per extra guest per night, in cents. Guests above `base_occupancy`
   * pay it (see `extraGuests`). Absent or null = not charged. Not used when
   * `managed`: the nights carry the app's fees instead.
   */
  extra_adult_fee_cents?: number | null
  extra_child_fee_cents?: number | null
  /**
   * The rate plan's prices come from a connected app (SiteMinder): each
   * night's `base_price_cents` is the app's price, no rate modifier applies
   * (discount rules are off), and extra guests pay the night's own fees
   * (`Night.extra_adult_fee_cents` / `extra_child_fee_cents`).
   */
  managed?: boolean
  /** Per cot / extra bed per night, in cents, paid at the property. 0 = free. */
  cot_fee_cents?: number | null
  extra_bed_fee_cents?: number | null
}

interface SearchParams {
  adults: number
  children: number
  /** Under 2: no place, no fee. Counted with the children for tourist tax only. */
  infants?: number
  arrivalDate: string
  /**
   * Cots and extra beds booked with the room, paid at the property (so never in
   * the room price). Checked against the room's limits by the caller.
   */
  cots?: number
  extraBeds?: number
}

/** A cot or extra bed line the guest pays at the property, fixed at booking. In cents. */
export interface PayAtPropertyLine {
  label: 'Cots' | 'Extra beds'
  count: number
  feePerNightCents: number
  nights: number
  amountCents: number
}

/** The one discount that applied, for the guest's checkout. `amountCents` is positive. */
export interface AppliedDiscount {
  label: string
  percent: number
  amountCents: number
}

/** The calendar date it is now at the property, as YYYY-MM-DD. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
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
      // The date's own weekday: parsed and read in UTC, so the server's
      // time zone cannot move it to the day before.
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
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
 * `delta_cents` is its contribution to the running total, and the last step's
 * `result_cents` is the resolved price. A host who adds the column up must
 * land on the number in the cell, or the panel is not an explanation.
 *
 * Amounts are integer cents, matching `bar_cents` and `price_per_night_cents`;
 * every step is already whole cents, so the column adds up exactly.
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
  /**
   * The figure behind the op: the amount itself in cents (`base`, `set`,
   * `extra`: the fee per guest per night), or the modifier's adjustment_value
   * (`percent`: a percentage; `flat`: cents).
   */
  value: number
  /** Signed contribution to the running total, in cents. */
  delta_cents: number
  /** Running total after this step, in cents. */
  result_cents: number
  /** Absent on base and override steps. */
  modifier_type?: ModifierType
}

interface CalculationState {
  nights: NightWithSurcharge[]
  /** Base prices plus surcharges, in cents: what a stay discount is taken of. */
  subtotal: number
  /** In cents. */
  total: number
  applied: Set<ModifierType>
  /** Built as the executor runs. Modifiers that never fire leave no step. */
  trace: PriceStep[]
  /** The stay discount kept by executeModifiers, if any. */
  discount?: Modifier
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
  const previous = state.trace[state.trace.length - 1]?.result_cents ?? 0
  return [
    ...state.trace,
    {
      label,
      op: modifier.adjustment_type === 'percent' ? 'percent' : 'flat',
      value: modifier.adjustment_value,
      delta_cents: delta,
      result_cents: previous + delta,
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
    const amount = rows.reduce((sum, n) => sum + n.base_price_cents, 0)
    running += amount
    steps.push({ label, op, value: amount, delta_cents: amount, result_cents: running })
  }

  push('Base rate', 'base', standard)
  push('Rate override', 'set', overridden)

  // Every night overridden, or none: either way a single step, and the label
  // already says which.
  return steps
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

/**
 * Add a modifier's surcharge to each night `applies` picks: its cents for a
 * flat rule, or its percentage of the night's base price, rounded half up to
 * a whole cent per night.
 */
function addSurcharge(
  state: CalculationState,
  modifier: Modifier,
  label: string,
  applies: (night: NightWithSurcharge) => boolean
): CalculationState {
  let totalSurcharge = 0
  const updatedNights = state.nights.map(night => {
    if (!applies(night)) return night
    const surcharge = modifier.adjustment_type === 'flat'
      ? modifier.adjustment_value
      : percentOfCents(night.base_price_cents, modifier.adjustment_value)
    totalSurcharge += surcharge
    return { ...night, _surcharge: night._surcharge + surcharge }
  })

  return {
    ...state,
    nights: updatedNights,
    subtotal: state.subtotal + totalSurcharge,
    total: state.total + totalSurcharge,
    applied: new Set([...state.applied, modifier.type]),
    trace: traceModifier(state, label, modifier, totalSurcharge),
  }
}

function applyDayOfWeek(
  state: CalculationState,
  modifier: Modifier,
  context: ModifierContext
): CalculationState {
  if (modifier.type !== 'day_of_week') return state
  return addSurcharge(state, modifier, 'Day of week', night =>
    isEligible(modifier, { ...context, date: night.date })
  )
}

function applyLastMinute(
  state: CalculationState,
  modifier: Modifier,
  context: ModifierContext
): CalculationState {
  if (modifier.type !== 'last_minute') return state

  const dummyContext = { ...context, date: context.arrivalDate }
  if (!isEligible(modifier, dummyContext)) return state

  // A surcharge on every night.
  return addSurcharge(state, modifier, 'Last minute', () => true)
}

/**
 * A stay discount: a percentage off each night's price with its surcharges,
 * rounded half up to a whole cent per night. A flat row is not a discount
 * (0042, 0050) and is ignored.
 */
function stayDiscount(type: ModifierType, label: string): ModifierStepFn {
  return (state, modifier, context) => {
    if (modifier.type !== type) return state

    const dummyContext = { ...context, date: context.arrivalDate }
    if (!isEligible(modifier, dummyContext)) return state
    if (modifier.adjustment_type !== 'percent') return state

    let discount = 0
    const nights = state.nights.map(night => {
      const off = percentOfCents(night.base_price_cents + night._surcharge, modifier.adjustment_value)
      discount += off
      return { ...night, _discount: night._discount + off }
    })

    return {
      ...state,
      nights,
      total: state.total + discount,
      applied: new Set([...state.applied, type]),
      trace: traceModifier(state, label, modifier, discount),
    }
  }
}

const applyLengthOfStay = stayDiscount('length_of_stay', 'Length of stay')
const applyEarlyBird = stayDiscount('early_bird', 'Early bird')
/** A lower last-minute price, as the stay's discount. */
const applyLastMinuteDiscount = stayDiscount('last_minute', 'Last minute')

// ─────────────────────────────────────────────
// Executor: run all modifiers in sort_order
// ─────────────────────────────────────────────

function executeModifiers(
  nights: Night[],
  modifiers: Modifier[],
  context: ModifierContext
): CalculationState {
  // Initial subtotal: sum of base prices
  const initialSubtotal = nights.reduce((sum, n) => sum + n.base_price_cents, 0)

  let state: CalculationState = {
    nights: nights.map(n => ({ ...n, _surcharge: 0, _discount: 0, _extra: 0 })),
    subtotal: initialSubtotal,
    total: initialSubtotal,
    applied: new Set(),
    trace: baseSteps(nights),
  }

  const sortedModifiers = [...modifiers].sort((a, b) => a.sort_order - b.sort_order)

  // `extra_guest` rows are no longer a rate rule: extra guests are priced from
  // the room (applyOccupancyAndExtras), so such a row is skipped.
  const stepFunctions: Partial<Record<ModifierType, ModifierStepFn>> = {
    day_of_week: applyDayOfWeek,
    last_minute: applyLastMinute,
    length_of_stay: applyLengthOfStay,
    early_bird: applyEarlyBird,
  }

  // Price adjustments first, in rule order, so a percentage discount is
  // always taken from the same figure whatever order the rules were added in.
  for (const modifier of sortedModifiers) {
    if (isStayDiscount(modifier)) continue
    const stepFn = stepFunctions[modifier.type]
    if (stepFn) state = stepFn(state, modifier, context)
  }

  // Then one discount: the one that takes the most off for this guest. A
  // discount always lowers the price, whatever sign it was stored with.
  let best = state
  for (const modifier of sortedModifiers) {
    if (!isStayDiscount(modifier)) continue
    const stepFn = discountSteps[modifier.type]
    if (!stepFn) continue
    const discounted = stepFn(state, { ...modifier, adjustment_value: -Math.abs(modifier.adjustment_value) }, context)
    if (discounted.total < best.total) best = { ...discounted, discount: modifier }
  }

  return best
}

/** Rules that are always a discount, whatever sign they were stored with. */
const DISCOUNT_TYPES = new Set<ModifierType>(['length_of_stay', 'early_bird'])

/**
 * Whether a rule competes as the stay's one discount (see executeModifiers).
 *
 * Length of stay and early booking always do. A last-minute rule does when
 * it lowers the price: a lower last-minute price is a discount, as on Airbnb
 * and Booking.com, so it never stacks on top of another one. Raised, it is a
 * price adjustment and always applies. Day-of-week rules are prices, up or
 * down, and always apply.
 */
export function isStayDiscount(modifier: Pick<Modifier, 'type' | 'adjustment_value'>): boolean {
  return DISCOUNT_TYPES.has(modifier.type) || (modifier.type === 'last_minute' && modifier.adjustment_value < 0)
}

/** How each kind of stay discount comes off; all are a percentage of each night. */
const discountSteps: Partial<Record<ModifierType, ModifierStepFn>> = {
  length_of_stay: applyLengthOfStay,
  early_bird: applyEarlyBird,
  last_minute: applyLastMinuteDiscount,
}

// ─────────────────────────────────────────────
// Main resolver
// ─────────────────────────────────────────────

/** Guests above base occupancy, as one checkout line, in cents. Already in `room_price_cents`, never discounted. */
export interface ExtraGuestLine {
  kind: 'adult' | 'child'
  count: number
  perNightCents: number
  nights: number
  amountCents: number
}

/** One night's price in cents. */
export interface NightPrice {
  date: string
  priceCents: number
}

/** Every amount is in cents. */
export interface ResolvedRoom
  extends Omit<RoomRow, 'nights' | 'modifiers' | 'tourist_tax_rules'> {
  nights: Night[]
  modifiers: Modifier[]
  /** Base prices, surcharges and extra guests, before the stay discount. */
  subtotal_cents: number
  /**
   * The room price after modifiers: the host's rate, incl. VAT, excl. tourist
   * tax. OpenBookings' commission is taken on this.
   */
  room_price_cents: number
  /** Worked out from the property's rules, on top of `room_price_cents`. */
  tourist_tax: TouristTaxResult
  /**
   * What the guest pays, all-in: `room_price_cents` plus
   * `tourist_tax.totalCents`. Rates include VAT by contract with the host, so
   * nothing else is added.
   */
  total_price_cents: number
  /**
   * What each night cost after modifiers, the stay discount and extra guests.
   * Every night is whole cents and they sum to `room_price_cents` exactly.
   */
  priced_nights: NightPrice[]
  /**
   * Each night's rate plus date surcharges, before the stay discount and extra
   * guests. Adds up with `extra_guests` minus `discount` to `room_price_cents`
   * exactly.
   */
  rate_nights: NightPrice[]
  /** Extra adults and children in `room_price_cents`. Empty when nobody is extra. */
  extra_guests: ExtraGuestLine[]
  /** Cots and extra beds, paid at the property: not in `room_price_cents` or `total_price_cents`. */
  pay_at_property: PayAtPropertyLine[]
  pay_at_property_total_cents: number
  /** The stay discount that applied, or null. Already in `room_price_cents`. */
  discount: AppliedDiscount | null
  applied_modifiers: ModifierType[]
  /** Ordered build-up of the room price. See PriceStep. */
  trace: PriceStep[]
}

export function resolveRoom(
  row: RoomRow,
  params: SearchParams,
  /** Defaults to today at the property (its `timezone`), so lead time matches the guest's arrival date. */
  todayAtProperty?: string
): ResolvedRoom {
  const today = todayAtProperty ?? todayInZone(row.timezone ?? 'UTC')
  const { adults, children, arrivalDate } = params
  const numNights = row.nights.length
  // Discount rules are off on a plan a connected app prices.
  const modifiers = row.managed ? [] : row.modifiers
  const modifiersRun = executeModifiers(row.nights, modifiers, { numNights, arrivalDate, today })

  const state = applyExtraGuests(modifiersRun, row, params)
  const payAtProperty = payAtPropertyLines(row, params, numNights)

  const roomPrice = state.total
  const priced = pricedNights(state)
  const touristTax = calculateTouristTax(row.tourist_tax_rules ?? [], {
    nights: priced,
    adults,
    children,
    infants: params.infants ?? 0,
    rooms: 1,
  })

  const { tourist_tax_rules: _rules, ...rest } = row
  return {
    ...rest,
    nights: row.nights, // return original nights (drop _surcharge)
    modifiers: row.modifiers,
    subtotal_cents: state.subtotal + extrasTotal(state),
    room_price_cents: roomPrice,
    tourist_tax: touristTax,
    total_price_cents: roomPrice + touristTax.totalCents,
    priced_nights: priced,
    rate_nights: state.nights.map(n => ({ date: n.date, priceCents: n.base_price_cents + n._surcharge })),
    extra_guests: extraGuestLines(row, params),
    pay_at_property: payAtProperty,
    pay_at_property_total_cents: payAtProperty.reduce((sum, l) => sum + l.amountCents, 0),
    discount: appliedDiscount(state),
    applied_modifiers: [...state.applied],
    trace: state.trace,
  }
}

// ─────────────────────────────────────────────
// Occupancy & extras (after the rate modifiers, never discounted)
// ─────────────────────────────────────────────

const extrasTotal = (state: CalculationState) => state.nights.reduce((sum, n) => sum + n._extra, 0)

type ExtraKind = ExtraGuestLine['kind']

/** Extra guests of one kind charged one fee (cents per guest per night) on these nights. */
type ExtraGroup = { kind: ExtraKind; count: number; fee: number; dates: Set<string> }

/**
 * One guest's extra fee on one night, in cents: the room's own fee, or on a
 * managed plan the app's fee for that night. Null = not charged.
 */
function extraFee(row: RoomRow, night: Night, kind: ExtraKind): number | null | undefined {
  if (row.managed) return kind === 'adult' ? night.extra_adult_fee_cents : night.extra_child_fee_cents
  return kind === 'adult' ? row.extra_adult_fee_cents : row.extra_child_fee_cents
}

/**
 * The charged extra guests of one kind, grouped by fee per night in order of
 * first appearance: one group on an unmanaged plan (the room's fee every
 * night); on a managed plan one per fee the app sent, so every group still
 * reads fee × nights. Nights without a fee charge nothing and are left out.
 */
function extraGroups(row: RoomRow, params: SearchParams): ExtraGroup[] {
  const extra = extraGuests(row.base_occupancy, params.adults, params.children)
  const groups: ExtraGroup[] = []
  for (const [kind, count] of [['adult', extra.adults], ['child', extra.children]] as const) {
    if (count <= 0) continue
    const byFee = new Map<number, Set<string>>()
    for (const night of row.nights) {
      const fee = extraFee(row, night, kind) ?? 0
      if (fee <= 0) continue
      const dates = byFee.get(fee) ?? new Set<string>()
      dates.add(night.date)
      byFee.set(fee, dates)
    }
    for (const [fee, dates] of byFee) groups.push({ kind, count, fee, dates })
  }
  return groups
}

/**
 * Add guests above base occupancy, per night, on top of the rate. Runs after
 * every rate modifier, so no discount reaches these fees. Infants take no
 * place. One trace line per fee that adds something.
 */
function applyExtraGuests(
  state: CalculationState,
  row: RoomRow,
  params: SearchParams
): CalculationState {
  let next = state
  for (const { kind, count, fee, dates } of extraGroups(row, params)) {
    const perNight = fee * count
    const delta = perNight * dates.size
    const previous = next.trace[next.trace.length - 1]?.result_cents ?? 0
    const label = kind === 'adult' ? 'Extra adults' : 'Extra children'
    next = {
      ...next,
      nights: next.nights.map(n => (dates.has(n.date) ? { ...n, _extra: n._extra + perNight } : n)),
      total: next.total + delta,
      trace: [...next.trace, { label, op: 'extra', value: fee, delta_cents: delta, result_cents: previous + delta }],
    }
  }
  return next
}

/** One line per kind of extra guest, and per fee, that is charged. Matches applyExtraGuests. */
function extraGuestLines(row: RoomRow, params: SearchParams): ExtraGuestLine[] {
  return extraGroups(row, params).map(({ kind, count, fee, dates }) => ({
    kind,
    count,
    perNightCents: fee * count,
    nights: dates.size,
    amountCents: fee * count * dates.size,
  }))
}

/**
 * Cots and extra beds the guest booked, priced for the hotel to collect. A free
 * one is still listed so the property knows to prepare it.
 */
function payAtPropertyLines(row: RoomRow, params: SearchParams, nights: number): PayAtPropertyLine[] {
  const lines: PayAtPropertyLine[] = []
  const add = (label: PayAtPropertyLine['label'], count: number, fee: number | null | undefined) => {
    if (count <= 0) return
    const perNight = fee ?? 0
    lines.push({ label, count, feePerNightCents: perNight, nights, amountCents: perNight * count * nights })
  }
  add('Cots', params.cots ?? 0, row.cot_fee_cents)
  add('Extra beds', params.extraBeds ?? 0, row.extra_bed_fee_cents)
  return lines
}

/** The guest-facing name of a discount: "Weekly discount", "Early booking discount"… */
export function discountLabel(modifier: Pick<Modifier, 'type' | 'trigger_condition'>): string {
  if (modifier.type === 'early_bird') return 'Early booking discount'
  if (modifier.type === 'last_minute') return 'Last-minute discount'
  const minNights = Number(modifier.trigger_condition.min_nights)
  if (minNights >= 28) return 'Monthly discount'
  if (minNights >= 7) return 'Weekly discount'
  return `${minNights}+ night discount`
}

/** The discount executeModifiers kept, with what it took off. */
function appliedDiscount(state: CalculationState): AppliedDiscount | null {
  const modifier = state.discount
  const step = state.trace.find(s => s.modifier_type === modifier?.type)
  if (!modifier || !step) return null
  return { label: discountLabel(modifier), percent: Math.abs(modifier.adjustment_value), amountCents: -step.delta_cents }
}

/**
 * What each night actually cost, for a tourist tax percentage and the stored
 * nights: its rate, surcharges, its own share of the stay discount (taken per
 * night, see stayDiscount) and its extra guests, never discounted. All whole
 * cents, so the nights sum to the room price exactly.
 */
function pricedNights(state: CalculationState): NightPrice[] {
  return state.nights.map(n => ({
    date: n.date,
    priceCents: n.base_price_cents + n._surcharge + n._discount + n._extra,
  }))
}

// ─────────────────────────────────────────────
// Per-night resolution (host ARI grid)
// ─────────────────────────────────────────────

export interface NightlyRate extends Night {
  /** Nights actually priced for this cell — `stayLength`, or fewer at the tail. */
  stay_length: number
  /** Total for the whole probe stay, in cents. */
  total_cents: number
  /**
   * Per-night average across the probe, in cents, rounded half up. This is
   * what a grid cell displays.
   */
  price_cents: number
  applied_modifiers: ModifierType[]
  /**
   * Ordered build-up of `total_cents`, the probe stay's total — not of `price_cents`.
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
      total_cents: state.total,
      price_cents: roundHalfUp(state.total / numNights),
      applied_modifiers: [...state.applied],
      trace: state.trace,
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
    if (!existing || room.total_price_cents < existing.total_price_cents) {
      byHotel.set(room.hotel_id, room)
    }
  }

  return [...byHotel.values()].sort((a, b) => a.total_price_cents - b.total_price_cents)
}