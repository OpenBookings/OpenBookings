// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type AdjustmentType = 'flat' | 'percent'

type ModifierType =
  | 'day_of_week'
  | 'length_of_stay'
  | 'early_bird'
  | 'last_minute'
  | 'extra_guest'

interface Night {
  date: string        // "2026-07-01"
  base_price: number
  has_override: boolean
}

interface NightWithSurcharge extends Night {
  _surcharge: number
}

interface Modifier {
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
  cancellation_policy: string
  min_stay: number
  max_stay: number | null
  nights: Night[]
  modifiers: Modifier[]
}

interface SearchParams {
  adults: number
  children: number
  arrivalDate: string
}

// ─────────────────────────────────────────────
// Modifier eligibility
// ─────────────────────────────────────────────

function isEligible(
  modifier: Modifier,
  context: {
    date: string
    numNights: number
    totalGuests: number
    baseOccupancy: number
    arrivalDate: string
    today: string
  }
): boolean {
  const { type, trigger_condition: tc } = modifier
  const { date, numNights, totalGuests, baseOccupancy, arrivalDate, today } = context

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

    case 'extra_guest': {
      return totalGuests > (tc.guests_above_base as number)
    }

    default:
      return false
  }
}

// ─────────────────────────────────────────────
// Calculation context (threaded through each step)
// ─────────────────────────────────────────────

interface CalculationState {
  nights: NightWithSurcharge[]
  subtotal: number
  total: number
  applied: Set<ModifierType>
}

// ─────────────────────────────────────────────
// Step functions (ordered by sort_order)
// ─────────────────────────────────────────────

function applyExtraGuest(
  state: CalculationState,
  modifier: Modifier,
  context: {
    extraGuests: number
    numNights: number
    totalGuests: number
    baseOccupancy: number
    arrivalDate: string
    today: string
  }
): CalculationState {
  if (modifier.type !== 'extra_guest') return state
  if (!context.extraGuests) return state

  const dummyContext = { ...context, date: context.arrivalDate }
  if (!isEligible(modifier, dummyContext)) return state

  // Apply surcharge to each night
  const updatedNights = state.nights.map(night => {
    const surcharge = modifier.adjustment_type === 'flat'
      ? modifier.adjustment_value * context.extraGuests
      : (night.base_price * modifier.adjustment_value * context.extraGuests) / 100

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
    applied: new Set([...state.applied, 'extra_guest']),
  }
}

function applyDayOfWeek(
  state: CalculationState,
  modifier: Modifier,
  context: {
    extraGuests: number
    numNights: number
    totalGuests: number
    baseOccupancy: number
    arrivalDate: string
    today: string
  }
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
  }
}

function applyLastMinute(
  state: CalculationState,
  modifier: Modifier,
  context: {
    extraGuests: number
    numNights: number
    totalGuests: number
    baseOccupancy: number
    arrivalDate: string
    today: string
  }
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
  }
}

function applyLengthOfStay(
  state: CalculationState,
  modifier: Modifier,
  context: {
    extraGuests: number
    numNights: number
    totalGuests: number
    baseOccupancy: number
    arrivalDate: string
    today: string
  }
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
  }
}

function applyEarlyBird(
  state: CalculationState,
  modifier: Modifier,
  context: {
    extraGuests: number
    numNights: number
    totalGuests: number
    baseOccupancy: number
    arrivalDate: string
    today: string
  }
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
  }
}

// ─────────────────────────────────────────────
// Executor: run all modifiers in sort_order
// ─────────────────────────────────────────────

function executeModifiers(
  nights: Night[],
  modifiers: Modifier[],
  context: {
    extraGuests: number
    numNights: number
    totalGuests: number
    baseOccupancy: number
    arrivalDate: string
    today: string
  }
): CalculationState {
  // Initial subtotal: sum of base prices
  const initialSubtotal = nights.reduce((sum, n) => sum + n.base_price, 0)

  let state: CalculationState = {
    nights: nights.map(n => ({ ...n, _surcharge: 0 })),
    subtotal: initialSubtotal,
    total: initialSubtotal,
    applied: new Set(),
  }

  // Sort by sort_order and execute each modifier
  const sortedModifiers = [...modifiers].sort((a, b) => a.sort_order - b.sort_order)

  // Only one discount may fire — the eligible one with the lowest sort_order
  const DISCOUNT_TYPES = new Set<ModifierType>(['length_of_stay', 'early_bird'])

  const stepFunctions: Record<ModifierType, Function> = {
    extra_guest: applyExtraGuest,
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

export interface ResolvedRoom extends Omit<RoomRow, 'nights' | 'modifiers'> {
  nights: Night[]
  modifiers: Modifier[]
  subtotal: number
  total_price: number
  applied_modifiers: ModifierType[]
}

export function resolveRoom(
  row: RoomRow,
  params: SearchParams,
  today: string = new Date().toISOString().split('T')[0]
): ResolvedRoom {
  const { adults, children, arrivalDate } = params
  const totalGuests = adults + children
  const extraGuests = Math.max(0, totalGuests - row.base_occupancy)
  const numNights = row.nights.length

  const state = executeModifiers(row.nights, row.modifiers, {
    extraGuests,
    numNights,
    totalGuests,
    baseOccupancy: row.base_occupancy,
    arrivalDate,
    today,
  })

  return {
    ...row,
    nights: row.nights, // return original nights (drop _surcharge)
    modifiers: row.modifiers,
    subtotal: round2(state.subtotal),
    total_price: round2(state.total),
    applied_modifiers: [...state.applied],
  }
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