"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { query } from "@openbookings/db";
import { userOwnsRatePlan, userOwnsRoom } from "@openbookings/authz";
import { auth } from "@/lib/auth";

/**
 * Bulk mutations behind the ARI toolbar modals. Every one of them writes a
 * date range, never a single cell — that is what hosts actually do, and it
 * keeps the grid free of a second editing surface.
 *
 * Ownership goes through @openbookings/authz on every call. The client passes
 * ids, so they are untrusted until checked; a failed check returns the same
 * generic error as a bad payload rather than confirming the id exists.
 */

const ROUTE = "/dashboard/listings/rates-availability";

export type ActionResult =
  | { ok: true; affected: number }
  | { ok: false; error: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const dateRange = z
  .object({ startDate: isoDate, endDate: isoDate })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date must not be before the start date",
    path: ["endDate"],
  });

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  return session;
}

function failed(message: string): ActionResult {
  return { ok: false, error: message };
}

// ─────────────────────────────────────────────
// Edit availability
// ─────────────────────────────────────────────

const availabilitySchema = dateRange.and(
  z.object({
    roomId: z.string().uuid(),
    /** Explicit availability. Null clears the override, restoring the computed baseline. */
    availableOverride: z.number().int().min(0).nullable(),
    /** Units withheld for maintenance or owner use. */
    blockedRooms: z.number().int().min(0),
    /** Per-date capacity override. Null inherits rooms.total_units. */
    totalRooms: z.number().int().min(0).nullable(),
    note: z.string().max(500).nullable(),
  }),
);

export type AvailabilityInput = z.infer<typeof availabilitySchema>;

/**
 * Upsert one room_inventory row per date in the range.
 *
 * The table is sparse by design, so this writes rows that may not exist yet —
 * generate_series supplies the dates and ON CONFLICT handles the ones that do.
 * Clearing the override (null) leaves the row in place: blocked_rooms and the
 * note are still worth keeping, and the computed baseline takes over.
 */
export async function setAvailability(
  input: AvailabilityInput,
): Promise<ActionResult> {
  const parsed = availabilitySchema.safeParse(input);
  if (!parsed.success) return failed(parsed.error.issues[0].message);
  const data = parsed.data;

  const session = await requireSession();
  if (!(await userOwnsRoom(session, data.roomId))) {
    return failed("Room type not found");
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO room_inventory
       (room_id, date, total_rooms, blocked_rooms, available_override, note, updated_by, updated_at)
     SELECT $1, d::date, $4, $5, $6, $7, $8, now()
     FROM generate_series($2::date, $3::date, INTERVAL '1 day') AS d
     ON CONFLICT (room_id, date) DO UPDATE SET
       total_rooms        = EXCLUDED.total_rooms,
       blocked_rooms      = EXCLUDED.blocked_rooms,
       available_override = EXCLUDED.available_override,
       note               = EXCLUDED.note,
       updated_by         = EXCLUDED.updated_by,
       updated_at         = now()
     RETURNING id`,
    [
      data.roomId,
      data.startDate,
      data.endDate,
      data.totalRooms,
      data.blockedRooms,
      data.availableOverride,
      data.note,
      session.user.id,
    ],
  );

  revalidatePath(ROUTE);
  return { ok: true, affected: rows.length };
}

// ─────────────────────────────────────────────
// Edit restrictions
// ─────────────────────────────────────────────

const restrictionSchema = dateRange
  .and(
    z.object({
      ratePlanId: z.string().uuid(),
      isClosed: z.boolean(),
      minStay: z.number().int().min(1).nullable(),
      maxStay: z.number().int().min(1).nullable(),
      closedToArrival: z.boolean(),
      closedToDeparture: z.boolean(),
      note: z.string().max(500).nullable(),
    }),
  )
  .refine(
    (v) =>
      v.isClosed ||
      v.closedToArrival ||
      v.closedToDeparture ||
      v.minStay !== null ||
      v.maxStay !== null,
    { message: "Set at least one restriction, or close the rate plan" },
  )
  .refine((v) => v.maxStay === null || v.minStay === null || v.maxStay >= v.minStay, {
    message: "Maximum stay must not be shorter than the minimum",
    path: ["maxStay"],
  });

export type RestrictionInput = z.infer<typeof restrictionSchema>;

/**
 * Write one restriction row covering the range.
 *
 * A closure and a stay rule are stored as separate rows even when set in the
 * same submission: the grid reads them through independent LATERALs so a date
 * can be both closed and min-stay-constrained without either fact being lost,
 * and reopening should not silently drop the stay rule.
 */
export async function setRestriction(
  input: RestrictionInput,
): Promise<ActionResult> {
  const parsed = restrictionSchema.safeParse(input);
  if (!parsed.success) return failed(parsed.error.issues[0].message);
  const data = parsed.data;

  const session = await requireSession();
  if (!(await userOwnsRatePlan(session, data.ratePlanId))) {
    return failed("Rate plan not found");
  }

  const hasStayRule =
    data.minStay !== null ||
    data.maxStay !== null ||
    data.closedToArrival ||
    data.closedToDeparture;

  const written: string[] = [];

  if (data.isClosed) {
    const rows = await query<{ id: string }>(
      `INSERT INTO rate_plan_restrictions
         (rate_plan_id, start_date, end_date, is_closed, note, created_by)
       VALUES ($1, $2, $3, TRUE, $4, $5)
       RETURNING id`,
      [data.ratePlanId, data.startDate, data.endDate, data.note, session.user.id],
    );
    written.push(...rows.map((r) => r.id));
  }

  if (hasStayRule) {
    const rows = await query<{ id: string }>(
      `INSERT INTO rate_plan_restrictions
         (rate_plan_id, start_date, end_date, is_closed,
          min_stay, max_stay, closed_to_arrival, closed_to_departure, note, created_by)
       VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        data.ratePlanId,
        data.startDate,
        data.endDate,
        data.minStay,
        data.maxStay,
        data.closedToArrival,
        data.closedToDeparture,
        data.note,
        session.user.id,
      ],
    );
    written.push(...rows.map((r) => r.id));
  }

  revalidatePath(ROUTE);
  return { ok: true, affected: written.length };
}

const clearSchema = dateRange.and(
  z.object({
    ratePlanId: z.string().uuid(),
    /** "closures" reopens; "restrictions" lifts stay rules; "all" does both. */
    scope: z.enum(["closures", "restrictions", "all"]),
  }),
);

export type ClearRestrictionsInput = z.infer<typeof clearSchema>;

/**
 * Deactivate rules overlapping the range — the "Reopen" path off the detail
 * panel. Rows are soft-deleted (is_active = false) rather than removed: the
 * panel reports who closed a date and when, and hard deletes would erase that
 * history the moment a host reopened.
 */
export async function clearRestrictions(
  input: ClearRestrictionsInput,
): Promise<ActionResult> {
  const parsed = clearSchema.safeParse(input);
  if (!parsed.success) return failed(parsed.error.issues[0].message);
  const data = parsed.data;

  const session = await requireSession();
  if (!(await userOwnsRatePlan(session, data.ratePlanId))) {
    return failed("Rate plan not found");
  }

  const scopeClause =
    data.scope === "closures"
      ? "AND is_closed"
      : data.scope === "restrictions"
        ? "AND NOT is_closed"
        : "";

  const rows = await query<{ id: string }>(
    `UPDATE rate_plan_restrictions
     SET is_active = FALSE
     WHERE rate_plan_id = $1
       AND is_active
       AND start_date <= $3::date
       AND end_date   >= $2::date
       ${scopeClause}
     RETURNING id`,
    [data.ratePlanId, data.startDate, data.endDate],
  );

  revalidatePath(ROUTE);
  return { ok: true, affected: rows.length };
}

// ─────────────────────────────────────────────
// Add rate plan
// ─────────────────────────────────────────────

const ratePlanSchema = z
  .object({
    roomId: z.string().uuid(),
    name: z.string().min(1).max(100),
    bar: z.number().int().min(0),
    currency: z.string().length(3),
    isRefundable: z.boolean(),
    cancellationPolicy: z.string().max(2000).nullable(),
    minStay: z.number().int().min(1),
    maxStay: z.number().int().min(1).nullable(),
  })
  .refine((v) => v.maxStay === null || v.maxStay >= v.minStay, {
    message: "Maximum stay must not be shorter than the minimum",
    path: ["maxStay"],
  });

export type RatePlanInput = z.infer<typeof ratePlanSchema>;

export async function createRatePlan(
  input: RatePlanInput,
): Promise<ActionResult> {
  const parsed = ratePlanSchema.safeParse(input);
  if (!parsed.success) return failed(parsed.error.issues[0].message);
  const data = parsed.data;

  const session = await requireSession();
  if (!(await userOwnsRoom(session, data.roomId))) {
    return failed("Room type not found");
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO rate_plans
       (room_id, name, bar, currency, is_refundable, cancellation_policy, min_stay, max_stay)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      data.roomId,
      data.name,
      data.bar,
      data.currency.toUpperCase(),
      data.isRefundable,
      data.cancellationPolicy,
      data.minStay,
      data.maxStay,
    ],
  );

  revalidatePath(ROUTE);
  return { ok: true, affected: rows.length };
}
