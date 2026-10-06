import {
  userOwnsProperty,
  userOwnsRatePlan,
  userOwnsRoom,
  type SessionLike,
} from "@openbookings/authz";
import { query as dbQuery, queryOne as dbQueryOne, withTransaction } from "@openbookings/db";
import type { z } from "zod";
import { purgePropertyPage, type PurgeTarget } from "@/lib/purge-property-page";
import type { FormState } from "../../_lib/editor";
import { canPublish } from "./completion";
import { LIMITS, BED_TYPE_KEYS } from "./constants";
import { bedLabel, catalogLabelsFor, copyName } from "./derive";
import { loadRoomEditor } from "./query";
import { amenitiesSchema, identitySchema, rateSchema, spaceSchema } from "./schema";
import type { RoomEditorData } from "./types";

/**
 * Every write the Rooms editor makes, minus the Next.js plumbing.
 *
 * Kept apart from actions.ts so each one can run against a fake database: the
 * "use server" wrappers there only resolve the session and revalidate. That is
 * what lets the test prove a non-owner is refused before anything is written.
 *
 * The authorization rule is the one the Property editor and R&A follow: every
 * id in a request is attacker-controlled, so ownership goes through
 * @openbookings/authz on every call (org membership included), and a failed
 * check reads exactly like an id that does not exist.
 */

type Query = <T>(text: string, values?: unknown[]) => Promise<T[]>;
type QueryOne = <T>(text: string, values?: unknown[]) => Promise<T | null>;
type Tx = { query: Query; queryOne: QueryOne };

export interface MutationDeps {
  query: Query;
  queryOne: QueryOne;
  /** Runs `fn` atomically. Statements must go through the `tx` it is handed. */
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Drops the guest listing page's cache; must never throw. */
  purge: (target: PurgeTarget) => Promise<void>;
  loadRoom: (session: SessionLike, roomId: string) => Promise<RoomEditorData | null>;
}

export const defaultDeps: MutationDeps = {
  query: dbQuery,
  queryOne: dbQueryOne,
  transaction: (fn) =>
    withTransaction((client) =>
      fn({
        query: async <T>(text: string, values?: unknown[]) =>
          (await client.query(text, values)).rows as T[],
        queryOne: async <T>(text: string, values?: unknown[]) =>
          ((await client.query(text, values)).rows[0] ?? null) as T | null,
      }),
    ),
  purge: (target) => purgePropertyPage(target),
  loadRoom: loadRoomEditor,
};

export type Result<Extra = object> =
  | ({ ok: true } & Extra)
  | { ok: false; error: string; code?: "future_bookings" | "last_active_rate" };

/** Thrown, not returned, from the form actions — the same as the Property editor's authorize(). */
export class NotFoundError extends Error {
  constructor() {
    // Deliberately not "forbidden": a host must not be able to probe which ids exist.
    super("Not found");
  }
}

/**
 * Bookings that still hold a room: everything not cancelled or no-show whose
 * check-out is after today in the property's own timezone. Wider than R&A's
 * "booked" (confirmed and completed): a pending booking is a guest at
 * checkout, and archiving or shrinking a room underneath them is the failure
 * this guard exists for.
 */
const HOLDING_STATUSES = `('pending', 'confirmed', 'completed')`;
const PROPERTY_TODAY = `(now() AT TIME ZONE p.timezone)::date`;

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return error.flatten().fieldErrors as Record<string, string[]>;
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function requireRoom(
  session: SessionLike,
  roomId: string,
  deps: MutationDeps,
): Promise<{ id: string; is_active: boolean }> {
  if (!roomId || !(await userOwnsRoom(session, roomId, { queryOne: deps.queryOne }))) {
    throw new NotFoundError();
  }
  // Archived rooms are read-only. Same refusal as an unknown id.
  const row = await deps.queryOne<{ id: string; is_active: boolean }>(
    `SELECT id, is_active FROM rooms WHERE id = $1 AND archived_at IS NULL`,
    [roomId],
  );
  if (!row) throw new NotFoundError();
  return row;
}

// ─────────────────────────────────────────────
// Room type lifecycle
// ─────────────────────────────────────────────

/**
 * A new room type starts as a draft (`is_active = false`, which is what guests
 * and search filter on) at the end of the list. The placeholder values are
 * the column's NOT NULL minimums; the editor's completion rules — not these
 * defaults — decide when it can go live.
 */
export async function createRoom(
  session: SessionLike,
  propertyId: string,
  deps: MutationDeps = defaultDeps,
): Promise<Result<{ roomId: string }>> {
  if (!propertyId || !(await userOwnsProperty(session, propertyId, { queryOne: deps.queryOne }))) {
    return { ok: false, error: "Property not found" };
  }

  const row = await deps.queryOne<{ id: string }>(
    `INSERT INTO rooms
       (property_id, name, base_occupancy, max_adults, max_children, total_units,
        is_active, amenity_keys, sort_order)
     VALUES ($1, 'New room type', 2, 2, 0, 1, false, '{}'::text[],
       (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM rooms WHERE property_id = $1))
     RETURNING id`,
    [propertyId],
  );
  return { ok: true, roomId: row!.id };
}

async function futureRoomBookings(roomId: string, deps: Pick<MutationDeps, "queryOne">) {
  const row = await deps.queryOne<{ n: number }>(
    `SELECT COUNT(DISTINCT b.id)::int AS n
     FROM reservations res
     JOIN bookings b   ON b.id = res.booking_id
     JOIN rooms r      ON r.id = res.room_id
     JOIN properties p ON p.id = r.property_id
     WHERE res.room_id = $1
       AND b.status IN ${HOLDING_STATUSES}
       AND b.check_out_date > ${PROPERTY_TODAY}`,
    [roomId],
  );
  return row?.n ?? 0;
}

/**
 * Archive, never delete: reservations reference the room. Refused while any
 * booking still holds it, because the guest is still coming — the host is
 * offered Unpublish instead, which stops new sales and keeps the booking whole.
 */
export async function archiveRoom(
  session: SessionLike,
  roomId: string,
  deps: MutationDeps = defaultDeps,
): Promise<Result> {
  if (!roomId || !(await userOwnsRoom(session, roomId, { queryOne: deps.queryOne }))) {
    return { ok: false, error: "Room type not found" };
  }

  const upcoming = await futureRoomBookings(roomId, deps);
  if (upcoming > 0) {
    return {
      ok: false,
      code: "future_bookings",
      error: `This room has ${upcoming} upcoming booking${upcoming === 1 ? "" : "s"}, so it cannot be archived. Unpublish it instead to stop new bookings.`,
    };
  }

  await deps.query(
    `UPDATE rooms SET archived_at = NOW(), is_active = false, updated_at = NOW()
     WHERE id = $1 AND archived_at IS NULL`,
    [roomId],
  );
  await deps.purge({ roomId });
  return { ok: true };
}

/**
 * Persist a drag-and-drop order. The UPDATE is scoped to the property, so an
 * id smuggled in from another property matches nothing — and a count that
 * does not line up refuses the whole reorder rather than half-applying it.
 */
export async function reorderRooms(
  session: SessionLike,
  propertyId: string,
  orderedIds: string[],
  deps: MutationDeps = defaultDeps,
): Promise<Result> {
  if (!propertyId || !(await userOwnsProperty(session, propertyId, { queryOne: deps.queryOne }))) {
    return { ok: false, error: "Property not found" };
  }
  const ids = [...new Set(orderedIds)];
  if (ids.length === 0 || ids.length !== orderedIds.length || ids.length > 500) {
    return { ok: false, error: "That order could not be saved." };
  }
  if (!ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))) {
    return { ok: false, error: "That order could not be saved." };
  }

  const saved = await deps.transaction(async (tx) => {
    const updated = await tx.query<{ id: string }>(
      `UPDATE rooms r SET sort_order = (t.ord - 1)::smallint, updated_at = NOW()
       FROM UNNEST($2::uuid[]) WITH ORDINALITY AS t(id, ord)
       WHERE r.id = t.id AND r.property_id = $1 AND r.archived_at IS NULL
       RETURNING r.id`,
      [propertyId, ids],
    );
    if (updated.length !== ids.length) throw new ReorderMismatch();
    return true;
  }).catch((error) => {
    if (error instanceof ReorderMismatch) return false;
    throw error;
  });

  if (!saved) return { ok: false, error: "Your rooms changed in the meantime. Reload and try again." };
  await deps.purge({ propertyId });
  return { ok: true };
}

class ReorderMismatch extends Error {}

/**
 * Publishing re-checks completeness against freshly loaded data: the client's
 * idea of "all five sections done" is a convenience, not an authority.
 * Un-publishing is never gated.
 */
export async function setRoomPublished(
  session: SessionLike,
  roomId: string,
  published: boolean,
  deps: MutationDeps = defaultDeps,
): Promise<Result> {
  if (!roomId || !(await userOwnsRoom(session, roomId, { queryOne: deps.queryOne }))) {
    return { ok: false, error: "Room type not found" };
  }

  if (published) {
    const data = await deps.loadRoom(session, roomId);
    if (!data || !canPublish(data)) {
      return { ok: false, error: "Finish every section before publishing." };
    }
  }

  await deps.query(
    `UPDATE rooms SET is_active = $1, updated_at = NOW() WHERE id = $2 AND archived_at IS NULL`,
    [published, roomId],
  );
  await deps.purge({ roomId });
  return { ok: true };
}

// ─────────────────────────────────────────────
// Room sections — useActionState form actions
// ─────────────────────────────────────────────

export async function saveRoomIdentity(
  session: SessionLike,
  formData: FormData,
  deps: MutationDeps = defaultDeps,
): Promise<FormState<{ name: string; description: string }>> {
  const roomId = str(formData, "roomId");
  const values = { name: str(formData, "name"), description: str(formData, "description") };

  await requireRoom(session, roomId, deps);

  const parsed = identitySchema.safeParse(values);
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error), success: false };

  await deps.query(
    `UPDATE rooms SET name = $1, description = $2, updated_at = NOW() WHERE id = $3`,
    [parsed.data.name, parsed.data.description, roomId],
  );
  await deps.purge({ roomId });
  return { values, errors: null, success: true };
}

export type SpaceValues = {
  sizeM2: string;
  maxAdults: string;
  maxChildren: string;
  units: string;
} & Record<`bed_${string}`, string>;

/**
 * The highest number of this room's units held on any single future night.
 * Counted per night, not per booking, because that is the grain availability
 * is computed at: two overlapping one-unit bookings need two units.
 */
async function peakFutureUnits(roomId: string, deps: Pick<MutationDeps, "queryOne">) {
  return deps.queryOne<{ date: string; units: number }>(
    `SELECT d::date::text AS date, COUNT(*)::int AS units
     FROM reservations res
     JOIN bookings b   ON b.id = res.booking_id
     JOIN rooms r      ON r.id = res.room_id
     JOIN properties p ON p.id = r.property_id
     CROSS JOIN LATERAL generate_series(
       GREATEST(b.check_in_date, ${PROPERTY_TODAY}),
       b.check_out_date - 1,
       INTERVAL '1 day'
     ) AS d
     WHERE res.room_id = $1
       AND b.status IN ${HOLDING_STATUSES}
       AND b.check_out_date > ${PROPERTY_TODAY}
     GROUP BY d
     ORDER BY units DESC, d
     LIMIT 1`,
    [roomId],
  );
}

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

/**
 * `total_units` is the baseline R&A computes availability from, so this is
 * the one place the units count is written. It cannot drop below what is
 * already booked on some future night: that would sell rooms that do not
 * exist. The refusal names the night, so the host knows where to look.
 */
export async function saveRoomSpace(
  session: SessionLike,
  formData: FormData,
  deps: MutationDeps = defaultDeps,
): Promise<FormState<SpaceValues>> {
  const roomId = str(formData, "roomId");
  const values = {
    sizeM2: str(formData, "sizeM2"),
    maxAdults: str(formData, "maxAdults"),
    maxChildren: str(formData, "maxChildren"),
    units: str(formData, "units"),
    ...Object.fromEntries(BED_TYPE_KEYS.map((k) => [`bed_${k}`, str(formData, `bed_${k}`) || "0"])),
  } as SpaceValues;

  await requireRoom(session, roomId, deps);

  const parsed = spaceSchema.safeParse({
    ...values,
    beds: Object.fromEntries(BED_TYPE_KEYS.map((k) => [k, values[`bed_${k}`]])),
  });
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error), success: false };
  const d = parsed.data;

  const peak = await peakFutureUnits(roomId, deps);
  if (peak && d.units < peak.units) {
    return {
      values,
      errors: {
        units: [
          `${peak.units} unit${peak.units === 1 ? " is" : "s are"} already booked on ${longDate(peak.date)}. Set at least ${peak.units}.`,
        ],
      },
      success: false,
    };
  }

  await deps.query(
    `UPDATE rooms
     SET size_sqm = $1, bed_config = $2::jsonb, bed_type = $3,
         max_adults = $4, max_children = $5, total_units = $6, updated_at = NOW()
     WHERE id = $7`,
    [
      d.sizeM2,
      JSON.stringify(d.beds),
      // The guest card still reads the free-text column, so it carries the
      // derived label rather than going stale.
      bedLabel(d.beds).slice(0, 100),
      d.maxAdults,
      d.maxChildren,
      d.units,
      roomId,
    ],
  );
  await deps.purge({ roomId });
  return { values, errors: null, success: true };
}

/**
 * Saves the keys, then mirrors the featured ones into `room_amenities`, the
 * table the guest room card reads its chips from today. Only keys with a row
 * in the shared catalogue can be mirrored; the rest wait for the guest app to
 * read `featured_amenity_keys` directly.
 */
export async function saveRoomAmenities(
  session: SessionLike,
  formData: FormData,
  deps: MutationDeps = defaultDeps,
): Promise<FormState<{ amenityKeys: string[]; featuredAmenityKeys: string[] }>> {
  const roomId = str(formData, "roomId");
  const values = {
    amenityKeys: formData.getAll("amenityKeys").map(String),
    featuredAmenityKeys: formData.getAll("featuredAmenityKeys").map(String),
  };

  await requireRoom(session, roomId, deps);

  const parsed = amenitiesSchema.safeParse(values);
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error), success: false };
  const d = parsed.data;

  await deps.transaction(async (tx) => {
    await tx.query(
      `UPDATE rooms SET amenity_keys = $1::text[], featured_amenity_keys = $2::text[], updated_at = NOW()
       WHERE id = $3`,
      [d.amenityKeys, d.featuredAmenityKeys, roomId],
    );
    await tx.query(`DELETE FROM room_amenities WHERE room_id = $1`, [roomId]);
    await tx.query(
      `INSERT INTO room_amenities (room_id, amenity_id)
       SELECT $1, a.id FROM amenities a WHERE a.label = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [roomId, catalogLabelsFor(d.featuredAmenityKeys)],
    );
  });

  await deps.purge({ roomId });
  return { values, errors: null, success: true };
}

// ─────────────────────────────────────────────
// Rate plans
// ─────────────────────────────────────────────

interface PlanRow {
  id: string;
  room_id: string;
  is_active: boolean;
  priced: boolean;
  room_published: boolean;
}

async function requirePlan(session: SessionLike, ratePlanId: string, deps: MutationDeps) {
  if (!ratePlanId || !(await userOwnsRatePlan(session, ratePlanId, { queryOne: deps.queryOne }))) {
    return null;
  }
  return deps.queryOne<PlanRow>(
    `SELECT rp.id, rp.room_id, rp.is_active, (rp.bar > 0) AS priced, r.is_active AS room_published
     FROM rate_plans rp JOIN rooms r ON r.id = rp.room_id
     WHERE rp.id = $1 AND rp.archived_at IS NULL AND r.archived_at IS NULL`,
    [ratePlanId],
  );
}

/** Other active rates on the same room, excluding this one. */
async function otherActiveRates(plan: PlanRow, deps: Pick<MutationDeps, "queryOne">) {
  const row = await deps.queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM rate_plans
     WHERE room_id = $1 AND id <> $2 AND is_active AND archived_at IS NULL`,
    [plan.room_id, plan.id],
  );
  return row?.n ?? 0;
}

const UNPRICED_MESSAGE =
  "This rate has no price yet. Set its base rate in R&A, then switch it on.";
const LAST_ACTIVE_MESSAGE =
  "This is the only active rate on a published room. Unpublish the room first, or switch on another rate.";

/**
 * The two rules on a rate's status, in one place so the Sheet and the inline
 * switch cannot drift: a rate goes on sale only once R&A has priced it (guest
 * search reads `bar` as the nightly price, so an unpriced rate would sell at
 * zero), and a published room never loses its last active rate.
 */
async function statusChangeError(plan: PlanRow, active: boolean, deps: MutationDeps) {
  if (active && !plan.priced) return { code: undefined, error: UNPRICED_MESSAGE };
  if (!active && plan.is_active && plan.room_published && (await otherActiveRates(plan, deps)) === 0) {
    return { code: "last_active_rate" as const, error: LAST_ACTIVE_MESSAGE };
  }
  return null;
}

export type RateValues = {
  ratePlanId: string;
  roomId: string;
  name: string;
  description: string;
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
  extras: string[];
  otherInclusion: string;
  minAdvanceDays: string;
  maxAdvanceDays: string;
  cancellationText: string;
  active: boolean;
};

/**
 * Create (no `ratePlanId`) or update a rate's descriptive terms. No price,
 * stay length or availability is written here — R&A owns those.
 *
 * A new rate is written with `bar = 0` (unpriced, so it cannot be activated
 * until R&A prices it) and `is_refundable = false`: checkout and search still
 * derive a free-cancellation promise from that flag, and the host has not
 * made one. Editing never touches either.
 */
export async function saveRate(
  session: SessionLike,
  formData: FormData,
  deps: MutationDeps = defaultDeps,
): Promise<FormState<RateValues>> {
  const raw = {
    name: str(formData, "name"),
    description: str(formData, "description"),
    breakfast: formData.get("breakfast"),
    lunch: formData.get("lunch"),
    dinner: formData.get("dinner"),
    extras: formData.getAll("extras").map(String),
    otherInclusion: str(formData, "otherInclusion"),
    minAdvanceDays: str(formData, "minAdvanceDays") || "0",
    maxAdvanceDays: str(formData, "maxAdvanceDays") || "none",
    cancellationText: str(formData, "cancellationText"),
    active: formData.get("active"),
  };
  const ratePlanId = str(formData, "ratePlanId");
  const roomId = str(formData, "roomId");
  const on = (v: unknown) => v === "on" || v === "true";
  const values: RateValues = {
    ...raw,
    ratePlanId,
    roomId,
    breakfast: on(raw.breakfast),
    lunch: on(raw.lunch),
    dinner: on(raw.dinner),
    active: on(raw.active),
  };

  // Ownership before validation, like every other section: a stranger's
  // request learns nothing, not even which fields would have been wrong.
  let plan: PlanRow | null = null;
  if (ratePlanId) {
    plan = await requirePlan(session, ratePlanId, deps);
    if (!plan) throw new NotFoundError();
  } else {
    await requireRoom(session, roomId, deps);
  }

  const parsed = rateSchema.safeParse(raw);
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error), success: false };
  const d = parsed.data;

  if (!plan && d.active) {
    return { values, errors: { active: [UNPRICED_MESSAGE] }, success: false };
  }
  if (plan && d.active !== plan.is_active) {
    const refusal = await statusChangeError(plan, d.active, deps);
    if (refusal) return { values, errors: { active: [refusal.error] }, success: false };
  }

  const terms = [
    d.name,
    d.description,
    d.breakfast,
    d.lunch,
    d.dinner,
    d.extras,
    d.otherInclusion,
    d.minAdvanceDays,
    d.maxAdvanceDays,
    d.cancellationText,
    d.active,
  ];

  if (plan) {
    await deps.query(
      `UPDATE rate_plans
       SET name = $1, description = $2, includes_breakfast = $3, includes_lunch = $4,
           includes_dinner = $5, extras = $6::text[], other_inclusion = $7,
           min_advance_booking = $8, max_advance_booking = $9, cancellation_policy = $10,
           is_active = $11, updated_at = NOW()
       WHERE id = $12`,
      [...terms, plan.id],
    );
  } else {
    await deps.query(
      `INSERT INTO rate_plans
         (room_id, name, description, includes_breakfast, includes_lunch, includes_dinner,
          extras, other_inclusion, min_advance_booking, max_advance_booking,
          cancellation_policy, is_active, bar, currency, is_refundable, sort_order)
       SELECT $12, $1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11,
              0,
              -- The property's currency, as its other rates state it.
              COALESCE((SELECT rp.currency FROM rate_plans rp
                        JOIN rooms r ON r.id = rp.room_id
                        WHERE r.property_id = (SELECT property_id FROM rooms WHERE id = $12)
                        ORDER BY rp.created_at LIMIT 1), 'EUR'),
              false,
              (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM rate_plans WHERE room_id = $12)`,
      [...terms, roomId],
    );
  }

  await deps.purge({ roomId: plan?.room_id ?? roomId });
  return { values, errors: null, success: true };
}

/** The inline Status switch in the rate table. Same rules as the Sheet. */
export async function setRateActive(
  session: SessionLike,
  ratePlanId: string,
  active: boolean,
  deps: MutationDeps = defaultDeps,
): Promise<Result> {
  const plan = await requirePlan(session, ratePlanId, deps);
  if (!plan) return { ok: false, error: "Rate not found" };
  if (plan.is_active === active) return { ok: true };

  const refusal = await statusChangeError(plan, active, deps);
  if (refusal) return { ok: false, ...refusal };

  await deps.query(`UPDATE rate_plans SET is_active = $1, updated_at = NOW() WHERE id = $2`, [
    active,
    plan.id,
  ]);
  await deps.purge({ roomId: plan.room_id });
  return { ok: true };
}

/**
 * Copies the rate's own row — terms and its base rate — but not the per-date
 * prices, modifiers or restrictions R&A keeps in other tables. Created
 * inactive, so the host reviews it before it sells.
 */
export async function duplicateRate(
  session: SessionLike,
  ratePlanId: string,
  deps: MutationDeps = defaultDeps,
): Promise<Result<{ ratePlanId: string }>> {
  const plan = await requirePlan(session, ratePlanId, deps);
  if (!plan) return { ok: false, error: "Rate not found" };

  const row = await deps.queryOne<{ id: string; name: string }>(
    `INSERT INTO rate_plans
       (room_id, name, description, includes_breakfast, includes_lunch, includes_dinner,
        extras, other_inclusion, min_advance_booking, max_advance_booking, cancellation_policy,
        bar, currency, is_refundable, booking_fee_rate, min_stay, max_stay,
        is_active, sort_order)
     SELECT room_id, $2, description, includes_breakfast, includes_lunch, includes_dinner,
            extras, other_inclusion, min_advance_booking, max_advance_booking, cancellation_policy,
            bar, currency, is_refundable, booking_fee_rate, min_stay, max_stay,
            false,
            (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM rate_plans WHERE room_id = src.room_id)
     FROM rate_plans src
     WHERE src.id = $1
     RETURNING id, name`,
    [plan.id, await copiedName(plan.id, deps)],
  );
  return { ok: true, ratePlanId: row!.id };
}

async function copiedName(ratePlanId: string, deps: Pick<MutationDeps, "queryOne">) {
  const src = await deps.queryOne<{ name: string }>(`SELECT name FROM rate_plans WHERE id = $1`, [
    ratePlanId,
  ]);
  return copyName(src?.name ?? "Rate", LIMITS.rateName.max);
}

/**
 * Archive, never delete: reservations reference rate plans. Refused while a
 * booking still holds the rate (the host is offered Deactivate, which stops
 * new sales), and refused for a published room's last active rate.
 */
export async function archiveRate(
  session: SessionLike,
  ratePlanId: string,
  deps: MutationDeps = defaultDeps,
): Promise<Result> {
  const plan = await requirePlan(session, ratePlanId, deps);
  if (!plan) return { ok: false, error: "Rate not found" };

  const upcoming = await deps.queryOne<{ n: number }>(
    `SELECT COUNT(DISTINCT b.id)::int AS n
     FROM reservations res
     JOIN bookings b   ON b.id = res.booking_id
     JOIN rooms r      ON r.id = res.room_id
     JOIN properties p ON p.id = r.property_id
     WHERE res.rate_plan_id = $1
       AND b.status IN ${HOLDING_STATUSES}
       AND b.check_out_date > ${PROPERTY_TODAY}`,
    [plan.id],
  );
  const n = upcoming?.n ?? 0;
  if (n > 0) {
    return {
      ok: false,
      code: "future_bookings",
      error: `This rate has ${n} upcoming booking${n === 1 ? "" : "s"}, so it cannot be archived. Switch it off instead to stop new bookings.`,
    };
  }

  const refusal = await statusChangeError(plan, false, deps);
  if (refusal) return { ok: false, ...refusal };

  await deps.query(
    `UPDATE rate_plans SET archived_at = NOW(), is_active = false, updated_at = NOW() WHERE id = $1`,
    [plan.id],
  );
  await deps.purge({ roomId: plan.room_id });
  return { ok: true };
}
