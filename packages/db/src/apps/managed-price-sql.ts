/**
 * The nightly price, shared by the three queries that price a rate plan night
 * by night — the stay quote (apps/web/lib/booking/quote.ts), guest search
 * (apps/web/app/api/query/route.ts) and the host rates grid
 * (apps/business/.../rates-availability/_lib/ari-query.ts) — so all three
 * decide alike where a night's price comes from (spec §2: Rates, Extra guest
 * fees come from SiteMinder).
 *
 * A LATERAL body, spliced as `CROSS JOIN LATERAL (${MANAGED_NIGHT_PRICE_SQL}) price`.
 * It relies on this name being in scope where it is spliced:
 *
 *   plan_night  a row with rate_plan_id uuid, bar_cents bigint,
 *               managed boolean (MANAGED_PROPERTY_SQL) and date date
 *
 * and returns one row:
 *
 *   base_price_cents       bigint   the night's price, or NULL (see `priced`)
 *   has_override           boolean  a rate_overrides row set the price
 *   override_label         text     that row's label
 *   extra_adult_fee_cents  bigint   the app's fee per extra adult, managed only
 *   extra_child_fee_cents  bigint   the app's fee per extra child, managed only
 *   priced                 boolean  false only for a managed night the app sent
 *                                   no price for
 *
 * An unmanaged plan is priced as it always was: the highest-priority active
 * override covering the night, else the plan's BAR. A managed plan takes the
 * app's price for the night (`app_rates`) and nothing else: no override, and
 * never the BAR. A managed night without an app price is not for sale (the
 * availability rule closes it, see `plan_rules` in availability.ts), so it
 * comes back unpriced and the callers must not sell or price it.
 */
export const MANAGED_NIGHT_PRICE_SQL = `
  SELECT
    CASE WHEN plan_night.managed THEN ar.price_cents
         ELSE COALESCE(o.price_per_night_cents, plan_night.bar_cents) END AS base_price_cents,
    (o.price_per_night_cents IS NOT NULL)                              AS has_override,
    o.label                                                            AS override_label,
    ar.extra_adult_cents                                               AS extra_adult_fee_cents,
    ar.extra_child_cents                                               AS extra_child_fee_cents,
    (NOT plan_night.managed OR ar.rate_plan_id IS NOT NULL)            AS priced
  FROM (SELECT 1) AS one
  LEFT JOIN app_rates ar
    ON plan_night.managed
   AND ar.rate_plan_id = plan_night.rate_plan_id
   AND ar.date = plan_night.date
  LEFT JOIN LATERAL (
    SELECT price_per_night_cents, label
    FROM rate_overrides
    WHERE NOT plan_night.managed
      AND rate_plan_id = plan_night.rate_plan_id
      AND start_date  <= plan_night.date
      AND end_date    >= plan_night.date
      AND is_active
    ORDER BY priority DESC
    LIMIT 1
  ) o ON TRUE
`;
