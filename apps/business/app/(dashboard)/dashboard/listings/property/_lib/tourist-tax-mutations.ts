import { userOwnsProperty, type SessionLike } from "@openbookings/authz";
import { queryOne as dbQueryOne } from "@openbookings/db";
import { touristTaxRuleSchema } from "./tourist-tax-schema";

/**
 * The tourist tax writes, minus the Next.js plumbing, so they can run against
 * a fake or a throwaway database. actions.ts resolves the session and
 * revalidates; everything that decides what may be written is here.
 *
 * Rules are history: once a rule has started it has applied to real nights,
 * so it is never edited or deleted. A host changes their tourist tax by adding
 * a rule with a later date. A rule may be deleted while it starts today or
 * later — no night has been charged under it yet, and bookings keep their own
 * copy of what they owed regardless.
 *
 * At most one rule waits to start: a host has the rule in force today and,
 * optionally, the next one. A rule starting today is always allowed — it
 * replaces the current one from today — but a second future rule is refused
 * until the waiting one is deleted.
 */

type QueryOne = <T>(text: string, values?: unknown[]) => Promise<T | null>;

export interface TouristTaxDeps {
  queryOne: QueryOne;
}

const defaultDeps: TouristTaxDeps = { queryOne: dbQueryOne };

export type Result<Extra = object> = ({ ok: true } & Extra) | { ok: false; error: string };

export class NotFoundError extends Error {
  constructor() {
    // Deliberately not "forbidden": a host must not be able to probe which ids exist.
    super("Not found");
  }
}

const PROPERTY_TODAY = `(now() AT TIME ZONE p.timezone)::date`;

async function requireProperty(session: SessionLike, propertyId: string, deps: TouristTaxDeps) {
  if (!propertyId || !(await userOwnsProperty(session, propertyId, { queryOne: deps.queryOne }))) {
    throw new NotFoundError();
  }
}

/** "1 January 2031". A `date` has no time zone, so it is formatted as UTC. */
function longDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function addTouristTaxRule(
  session: SessionLike,
  propertyId: string,
  input: unknown,
  deps: TouristTaxDeps = defaultDeps,
): Promise<Result<{ ruleId: string }>> {
  await requireProperty(session, propertyId, deps);

  const parsed = touristTaxRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const rule = parsed.data;

  // One statement decides "not in the past" (in the property's own time zone),
  // "no other rule waiting" and "not a duplicate". Two saves racing within the
  // same instant could both pass the waiting check; for a host clicking Save
  // that is not a real case, and pricing stays correct either way (each night
  // takes the latest rule that has started).
  const row = await deps.queryOne<{ id: string }>(
    `INSERT INTO tourist_tax_rules
       (property_id, effective_from, charges, children_exempt, max_nights, created_by)
     SELECT p.id, $2::date, $3::jsonb, $4, $5, $6
     FROM properties p
     WHERE p.id = $1
       AND $2::date >= ${PROPERTY_TODAY}
       AND NOT ($2::date > ${PROPERTY_TODAY} AND EXISTS (
         SELECT 1 FROM tourist_tax_rules w
         WHERE w.property_id = p.id AND w.effective_from > ${PROPERTY_TODAY}
       ))
     ON CONFLICT (property_id, effective_from) DO NOTHING
     RETURNING id`,
    [
      propertyId,
      rule.effectiveFrom,
      JSON.stringify(rule.charges),
      rule.childrenExempt,
      rule.maxNights,
      session.user.id,
    ],
  );
  if (row) return { ok: true, ruleId: row.id };

  const why = await deps.queryOne<{ past: boolean; waiting: string | null }>(
    `SELECT $2::date < ${PROPERTY_TODAY} AS past,
            (SELECT w.effective_from::text FROM tourist_tax_rules w
             WHERE w.property_id = p.id AND w.effective_from > ${PROPERTY_TODAY}
             ORDER BY w.effective_from LIMIT 1) AS waiting
     FROM properties p WHERE p.id = $1`,
    [propertyId, rule.effectiveFrom],
  );
  if (why?.past) return { ok: false, error: "A new rule cannot start in the past." };
  if (why?.waiting && why.waiting !== rule.effectiveFrom) {
    return {
      ok: false,
      error: `You already have a rule starting on ${longDate(why.waiting)}. Delete it first to plan a different one.`,
    };
  }
  return {
    ok: false,
    error: `There is already a rule starting on ${longDate(rule.effectiveFrom)}. Delete it first, or pick another date.`,
  };
}

export async function deleteTouristTaxRule(
  session: SessionLike,
  propertyId: string,
  ruleId: string,
  deps: TouristTaxDeps = defaultDeps,
): Promise<Result> {
  await requireProperty(session, propertyId, deps);

  const row = await deps.queryOne<{ id: string }>(
    `DELETE FROM tourist_tax_rules t
     USING properties p
     WHERE t.id = $1 AND t.property_id = $2 AND p.id = t.property_id
       AND t.effective_from >= ${PROPERTY_TODAY}
     RETURNING t.id`,
    [ruleId, propertyId],
  );
  if (row) return { ok: true };
  return {
    ok: false,
    error: "This rule has already started, so it stays as a record. Add a new rule to change your tourist tax.",
  };
}
