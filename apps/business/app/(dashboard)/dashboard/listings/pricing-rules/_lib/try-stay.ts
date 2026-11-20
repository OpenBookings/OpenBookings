import { getHostScopedDb, propertyReadAccessSql, type SessionLike } from "@openbookings/authz";
import {
  discountLabel,
  isStayDiscount,
  resolveRoom,
  type Modifier,
  type Night,
  type RoomRow,
} from "@openbookings/pricing";
import { amountLabel, TRY_STAY_MAX_NIGHTS, whenLabel } from "./rule-model";

/**
 * "Try a stay": what a guest would pay for one stay on one rate plan, built
 * up line by line, with the same engine checkout uses (resolveRoom). The
 * party is the room's base occupancy, so no extra-guest fees; tourist tax is
 * left out, as the page says.
 *
 * Every line comes from the engine itself rather than from re-doing its
 * maths: each price adjustment's line is the difference it makes when added,
 * and each discount is priced on its own to show which one wins.
 */

type HostDb = Pick<ReturnType<typeof getHostScopedDb>, "query" | "queryOne">;

export type TryStayInput = { ratePlanId: string; arrival: string; nights: number; bookedOn: string };

export type TryStayLine = { label: string; amount: number };

export type TryStayResult =
  | {
      ok: true;
      nights: number;
      /** Sum of each night's price before any rule: base rate or a date's own price. */
      base: number;
      /** True when a price set for a single date replaced the base rate on some night. */
      hasDatePrices: boolean;
      adjustments: TryStayLine[];
      discount: TryStayLine | null;
      /** Discounts the stay also qualified for, which the winner beat. */
      beaten: TryStayLine[];
      total: number;
    }
  | { ok: false; error: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const PLAN_SQL = `
SELECT rp.id::text AS id, rp.bar::float8 AS bar, r.base_occupancy, p.timezone
FROM rate_plans rp
JOIN rooms r      ON r.id = rp.room_id
JOIN properties p ON p.id = r.property_id
WHERE ${propertyReadAccessSql("$1")} AND rp.id = $2`;

/** Each night's price before rules: the newest active date price, else the base rate. */
const NIGHTS_SQL = `
SELECT d.d::date::text AS date,
       COALESCE(o.price_per_night, $3::numeric)::float8 AS base_price,
       (o.price_per_night IS NOT NULL) AS has_override
FROM generate_series($4::date, $4::date + ($5::int - 1), interval '1 day') AS d(d)
LEFT JOIN LATERAL (
  SELECT price_per_night FROM rate_overrides
  WHERE rate_plan_id = $2 AND start_date <= d.d AND end_date >= d.d AND is_active
  ORDER BY priority DESC LIMIT 1
) o ON TRUE
WHERE $1::text IS NOT NULL
ORDER BY d.d`;

const MODIFIERS_SQL = `
SELECT type, adjustment_type, adjustment_value::float8 AS adjustment_value, trigger_condition, sort_order
FROM rate_modifiers
WHERE $1::text IS NOT NULL AND rate_plan_id = $2 AND is_active AND type <> 'extra_guest'
ORDER BY sort_order, id`;

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function priceTryStay(
  session: SessionLike,
  input: TryStayInput,
  db: HostDb = getHostScopedDb(session),
): Promise<TryStayResult> {
  const nights = Math.trunc(Number(input.nights));
  if (!ISO.test(input.arrival) || !ISO.test(input.bookedOn)) return { ok: false, error: "Pick the dates." };
  if (!(nights >= 1 && nights <= TRY_STAY_MAX_NIGHTS)) {
    return { ok: false, error: `Enter 1 to ${TRY_STAY_MAX_NIGHTS} nights.` };
  }
  if (input.bookedOn > input.arrival) return { ok: false, error: "Booked on must be on or before arrival." };

  const plan = await db.queryOne<{ id: string; bar: number; base_occupancy: number; timezone: string }>(PLAN_SQL, [
    input.ratePlanId,
  ]);
  if (!plan) return { ok: false, error: "Rate plan not found" };

  const [nightRows, modifiers] = await Promise.all([
    db.query<{ date: string; base_price: number; has_override: boolean }>(NIGHTS_SQL, [
      plan.id,
      plan.bar,
      input.arrival,
      nights,
    ]),
    db.query<Modifier>(MODIFIERS_SQL, [plan.id]),
  ]);

  const nightList: Night[] = nightRows.map((n) => ({
    date: n.date,
    base_price: Number(n.base_price),
    has_override: n.has_override,
  }));
  return { ok: true, ...breakDown(nightList, modifiers.map(numeric), plan.base_occupancy, input) };
}

const numeric = (m: Modifier): Modifier => ({ ...m, adjustment_value: Number(m.adjustment_value) });

/** The line-by-line build-up. Exported for tests: no database. */
export function breakDown(
  nights: Night[],
  modifiers: Modifier[],
  baseOccupancy: number,
  input: Pick<TryStayInput, "arrival" | "bookedOn">,
): Omit<Extract<TryStayResult, { ok: true }>, "ok"> {
  const price = (mods: Modifier[]) =>
    resolveRoom(
      { base_occupancy: baseOccupancy, nights, modifiers: mods } as unknown as RoomRow,
      { adults: baseOccupancy, children: 0, arrivalDate: input.arrival },
      input.bookedOn,
    );

  const sorted = [...modifiers].sort((a, b) => a.sort_order - b.sort_order);
  const adjustmentRules = sorted.filter((m) => !isStayDiscount(m));
  const discountRules = sorted.filter((m) => isStayDiscount(m));

  const base = price([]).room_price;
  const adjustments: TryStayLine[] = [];
  let running = base;
  for (let i = 0; i < adjustmentRules.length; i++) {
    const next = price(adjustmentRules.slice(0, i + 1)).room_price;
    const rule = adjustmentRules[i];
    if (next !== running) {
      adjustments.push({
        label: `${whenLabel({ type: rule.type, triggerCondition: rule.trigger_condition, adjustmentType: rule.adjustment_type })} ${amountLabel({ adjustmentType: rule.adjustment_type, adjustmentValue: rule.adjustment_value })}`,
        amount: round2(next - running),
      });
    }
    running = next;
  }

  const full = price(sorted);
  const discount = full.discount ? { label: `${full.discount.label} −${full.discount.percent}%`, amount: -full.discount.amount } : null;

  // Every discount the stay qualifies for, priced alone on top of the
  // adjustments, so the page can say which one the winner beat.
  const beaten: TryStayLine[] = [];
  for (const rule of discountRules) {
    const alone = price([...adjustmentRules, rule]).discount;
    if (!alone) continue;
    const label = `${discountLabel(rule)} −${alone.percent}%`;
    if (discount && label === discount.label) continue;
    beaten.push({ label, amount: -alone.amount });
  }

  return {
    nights: nights.length,
    base,
    hasDatePrices: nights.some((n) => n.has_override),
    adjustments,
    discount,
    beaten,
    total: full.room_price,
  };
}
