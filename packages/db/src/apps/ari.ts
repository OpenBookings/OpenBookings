/**
 * Availability, rates and restrictions pushed by a connected app (0060).
 * Stored in app_inventory / app_rates / app_restrictions, apart from the
 * host's own tables.
 */
import type { AriBatch, AriResult } from "@openbookings/apps-contract";
import type { Queryable } from "../reservation-policy";
import type { Installation } from "./installations";

type CodeRow = { kind: "room" | "plan"; code: string; id: string };

/**
 * Write an app's ARI batch.
 *
 * Codes are resolved against the installation's property first; a code of
 * another property, an unknown code or an archived room or rate plan makes the
 * whole batch fail with `unknownCodes` (in batch order) before anything is
 * written. Otherwise all three kinds go in as ONE statement (data-modifying
 * CTEs), so the writes are atomic whatever `db` is: a Pool, a client or a
 * transaction. A failure halfway leaves nothing behind, and no caller-managed
 * transaction is needed.
 *
 * Set-based: every change is expanded to one row per night with
 * generate_series, in a single round trip. Within a batch changes apply in
 * order, last write wins. Inventory and rates replace the stored night.
 * Restrictions are patches: only fields present in a change are written (a
 * stay limit present as null clears it), absent fields keep the stored value,
 * and a night with no row yet starts open with no stay limits. Several
 * restriction changes for one night merge field by field, later changes
 * winning. `received_at` is `now` on every written row.
 *
 * Returns the number of nights written, counting a night once per change that
 * covers it.
 */
export async function applyAriBatch(
  db: Queryable,
  installation: Installation,
  batch: AriBatch,
  now: Date,
): Promise<AriResult> {
  if (batch.inventory.length + batch.rates.length + batch.restrictions.length === 0) {
    return { ok: true, nights: 0 };
  }

  const roomCodes = [...new Set(batch.inventory.map((c) => c.roomCode))];
  const planCodes = [...new Set([...batch.rates, ...batch.restrictions].map((c) => c.ratePlanCode))];
  const resolved = (
    await db.query(
      `SELECT 'room' AS kind, r.channel_code AS code, r.id
         FROM rooms r
        WHERE r.property_id = $1::uuid AND r.archived_at IS NULL AND r.channel_code = ANY($2::text[])
       UNION ALL
       SELECT 'plan', p.channel_code, p.id
         FROM rate_plans p JOIN rooms r ON r.id = p.room_id
        WHERE r.property_id = $1::uuid AND r.archived_at IS NULL AND p.archived_at IS NULL
          AND p.channel_code = ANY($3::text[])`,
      [installation.propertyId, roomCodes, planCodes],
    )
  ).rows as CodeRow[];
  const roomIds = new Map(resolved.filter((r) => r.kind === "room").map((r) => [r.code, r.id]));
  const planIds = new Map(resolved.filter((r) => r.kind === "plan").map((r) => [r.code, r.id]));

  const unknownCodes = [
    ...new Set([
      ...batch.inventory.filter((c) => !roomIds.has(c.roomCode)).map((c) => c.roomCode),
      ...batch.rates.filter((c) => !planIds.has(c.ratePlanCode)).map((c) => c.ratePlanCode),
      ...batch.restrictions.filter((c) => !planIds.has(c.ratePlanCode)).map((c) => c.ratePlanCode),
    ]),
  ];
  if (unknownCodes.length > 0) return { ok: false, error: "unknown codes", unknownCodes };

  // `{...c, id}`: JSON.stringify drops absent (undefined) keys, keeps explicit nulls;
  // the SQL tells them apart with the jsonb `?` operator.
  const inventory = JSON.stringify(batch.inventory.map((c) => ({ ...c, id: roomIds.get(c.roomCode) })));
  const rates = JSON.stringify(batch.rates.map((c) => ({ ...c, id: planIds.get(c.ratePlanCode) })));
  const restrictions = JSON.stringify(batch.restrictions.map((c) => ({ ...c, id: planIds.get(c.ratePlanCode) })));

  const result = await db.query(
    `WITH
     inv AS (
       SELECT (e.c->>'id')::uuid AS id, d::date AS date, (e.c->>'unitsLeft')::int AS units_left, e.ord
         FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY e(c, ord)
        CROSS JOIN LATERAL generate_series((e.c->>'from')::timestamp, (e.c->>'to')::timestamp, interval '1 day') d
     ),
     rat AS (
       SELECT (e.c->>'id')::uuid AS id, d::date AS date, (e.c->>'priceCents')::bigint AS price,
              (e.c->>'extraAdultCents')::bigint AS extra_adult, (e.c->>'extraChildCents')::bigint AS extra_child, e.ord
         FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY e(c, ord)
        CROSS JOIN LATERAL generate_series((e.c->>'from')::timestamp, (e.c->>'to')::timestamp, interval '1 day') d
     ),
     res AS (
       SELECT (e.c->>'id')::uuid AS id, d::date AS date, e.c, e.ord
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY e(c, ord)
        CROSS JOIN LATERAL generate_series((e.c->>'from')::timestamp, (e.c->>'to')::timestamp, interval '1 day') d
     ),
     res_merged AS (
       SELECT id, date,
              bool_or(c->>'closed' IS NOT NULL) AS has_closed,
              (array_agg((c->>'closed')::boolean ORDER BY ord DESC) FILTER (WHERE c->>'closed' IS NOT NULL))[1] AS closed,
              bool_or(c->>'closedToArrival' IS NOT NULL) AS has_cta,
              (array_agg((c->>'closedToArrival')::boolean ORDER BY ord DESC) FILTER (WHERE c->>'closedToArrival' IS NOT NULL))[1] AS cta,
              bool_or(c->>'closedToDeparture' IS NOT NULL) AS has_ctd,
              (array_agg((c->>'closedToDeparture')::boolean ORDER BY ord DESC) FILTER (WHERE c->>'closedToDeparture' IS NOT NULL))[1] AS ctd,
              bool_or(c ? 'minStayArrival') AS has_min_arr,
              (array_agg((c->>'minStayArrival')::int ORDER BY ord DESC) FILTER (WHERE c ? 'minStayArrival'))[1] AS min_arr,
              bool_or(c ? 'maxStayArrival') AS has_max_arr,
              (array_agg((c->>'maxStayArrival')::int ORDER BY ord DESC) FILTER (WHERE c ? 'maxStayArrival'))[1] AS max_arr,
              bool_or(c ? 'minStayThrough') AS has_min_thr,
              (array_agg((c->>'minStayThrough')::int ORDER BY ord DESC) FILTER (WHERE c ? 'minStayThrough'))[1] AS min_thr,
              bool_or(c ? 'maxStayThrough') AS has_max_thr,
              (array_agg((c->>'maxStayThrough')::int ORDER BY ord DESC) FILTER (WHERE c ? 'maxStayThrough'))[1] AS max_thr
         FROM res
        GROUP BY id, date
     ),
     w_inv AS (
       INSERT INTO app_inventory (room_id, date, units_left, received_at)
       SELECT DISTINCT ON (id, date) id, date, units_left, $4::timestamptz
         FROM inv ORDER BY id, date, ord DESC
       ON CONFLICT (room_id, date) DO UPDATE
          SET units_left = EXCLUDED.units_left, received_at = EXCLUDED.received_at
       RETURNING 1
     ),
     w_rat AS (
       INSERT INTO app_rates (rate_plan_id, date, price_cents, extra_adult_cents, extra_child_cents, received_at)
       SELECT DISTINCT ON (id, date) id, date, price, extra_adult, extra_child, $4::timestamptz
         FROM rat ORDER BY id, date, ord DESC
       ON CONFLICT (rate_plan_id, date) DO UPDATE
          SET price_cents = EXCLUDED.price_cents, extra_adult_cents = EXCLUDED.extra_adult_cents,
              extra_child_cents = EXCLUDED.extra_child_cents, received_at = EXCLUDED.received_at
       RETURNING 1
     ),
     w_res AS (
       MERGE INTO app_restrictions t
       USING res_merged s ON t.rate_plan_id = s.id AND t.date = s.date
       WHEN MATCHED THEN UPDATE SET
         is_closed = CASE WHEN s.has_closed THEN s.closed ELSE t.is_closed END,
         closed_to_arrival = CASE WHEN s.has_cta THEN s.cta ELSE t.closed_to_arrival END,
         closed_to_departure = CASE WHEN s.has_ctd THEN s.ctd ELSE t.closed_to_departure END,
         min_stay_arrival = CASE WHEN s.has_min_arr THEN s.min_arr ELSE t.min_stay_arrival END,
         max_stay_arrival = CASE WHEN s.has_max_arr THEN s.max_arr ELSE t.max_stay_arrival END,
         min_stay_through = CASE WHEN s.has_min_thr THEN s.min_thr ELSE t.min_stay_through END,
         max_stay_through = CASE WHEN s.has_max_thr THEN s.max_thr ELSE t.max_stay_through END,
         received_at = $4::timestamptz
       WHEN NOT MATCHED THEN INSERT
         (rate_plan_id, date, is_closed, closed_to_arrival, closed_to_departure,
          min_stay_arrival, max_stay_arrival, min_stay_through, max_stay_through, received_at)
         VALUES (s.id, s.date, COALESCE(s.closed, false), COALESCE(s.cta, false), COALESCE(s.ctd, false),
                 s.min_arr, s.max_arr, s.min_thr, s.max_thr, $4::timestamptz)
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM inv) + (SELECT count(*) FROM rat) + (SELECT count(*) FROM res) AS nights`,
    [inventory, rates, restrictions, now],
  );
  return { ok: true, nights: Number((result.rows[0] as { nights: string | number }).nights) };
}
