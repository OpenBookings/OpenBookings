/**
 * Postgres side of the analytics month cache (tables and triggers: migration
 * 0057). The hotel id is an argument from the session-resolved caller.
 */
import { query } from "@openbookings/db";
import { FACTS_CACHE_VERSION, type MonthGenerations, type MonthStore } from "./facts-cache";
import type { Facts, IsoDate } from "./types";

/** The hotel-wide sentinel row of analytics_month_generation. */
const SENTINEL = "0001-01-01";

export function createMonthStore(): MonthStore {
  return {
    async read(propertyId, months) {
      const out = new Map<IsoDate, Facts>();
      if (months.length === 0) return out;
      const rows = await query<{ month: string; facts: Facts }>(
        `SELECT c.month::text AS month, c.facts
           FROM analytics_month_cache c
           LEFT JOIN analytics_month_generation g ON g.hotel_id = c.hotel_id AND g.month = c.month
           LEFT JOIN analytics_month_generation h ON h.hotel_id = c.hotel_id AND h.month = $4::date
          WHERE c.hotel_id = $1 AND c.month = ANY($2::date[])
            AND c.version = $3
            AND c.generation = coalesce(g.generation, 0)
            AND c.hotel_generation = coalesce(h.generation, 0)`,
        [propertyId, months, FACTS_CACHE_VERSION, SENTINEL],
      );
      for (const r of rows) out.set(r.month, r.facts);
      return out;
    },

    async generations(propertyId, months) {
      const rows = await query<{ month: string; generation: string | number }>(
        `SELECT month::text AS month, generation FROM analytics_month_generation
          WHERE hotel_id = $1 AND month = ANY($2::date[] || $3::date)`,
        [propertyId, months, SENTINEL],
      );
      const found = new Map(rows.map((r) => [r.month, Number(r.generation)]));
      return {
        months: new Map(months.map((m) => [m, found.get(m) ?? 0])),
        hotel: found.get(SENTINEL) ?? 0,
      };
    },

    async write(propertyId, month, gen: MonthGenerations, facts) {
      // One statement: the row is stored only if both generations are still
      // the ones the build started from.
      await query(
        `INSERT INTO analytics_month_cache (hotel_id, month, version, generation, hotel_generation, facts, built_at)
         SELECT $1, $2::date, $3, $4, $5, $6::jsonb, now()
          WHERE coalesce((SELECT generation FROM analytics_month_generation WHERE hotel_id = $1 AND month = $2::date), 0) = $4
            AND coalesce((SELECT generation FROM analytics_month_generation WHERE hotel_id = $1 AND month = $7::date), 0) = $5
         ON CONFLICT (hotel_id, month) DO UPDATE
           SET version = EXCLUDED.version, generation = EXCLUDED.generation,
               hotel_generation = EXCLUDED.hotel_generation, facts = EXCLUDED.facts, built_at = EXCLUDED.built_at`,
        [propertyId, month, FACTS_CACHE_VERSION, gen.month, gen.hotel, JSON.stringify(facts), SENTINEL],
      );
    },
  };
}
