"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { query, withTransaction } from "@openbookings/db";
import { userOwnsRatePlan, userOwnsRoom } from "@openbookings/authz";
import { VERSION_SQL } from "./ari-query";
import { groupConsecutiveDates } from "./runs";
import { getServerSession } from "@/lib/auth";

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
  const session = await getServerSession();
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

// ─────────────────────────────────────────────
// Room-type closures
// ─────────────────────────────────────────────

const roomClosureSchema = dateRange.and(
  z.object({
    roomId: z.string().uuid(),
    note: z.string().max(500).nullable(),
  }),
);

export type RoomClosureInput = z.infer<typeof roomClosureSchema>;

/**
 * Close a whole room type for a range.
 *
 * Deliberately not "close every rate plan on it": that loses the fact that it
 * was one decision, reports the reason once per plan, and leaves the next plan
 * anyone adds to the room quietly open on dates the room is shut.
 */
export async function closeRoomType(
  input: RoomClosureInput,
): Promise<ActionResult> {
  const parsed = roomClosureSchema.safeParse(input);
  if (!parsed.success) return failed(parsed.error.issues[0].message);
  const data = parsed.data;

  const session = await requireSession();
  if (!(await userOwnsRoom(session, data.roomId))) {
    return failed("Room type not found");
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO room_closures (room_id, start_date, end_date, note, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [data.roomId, data.startDate, data.endDate, data.note, session.user.id],
  );

  revalidatePath(ROUTE);
  return { ok: true, affected: rows.length };
}

const reopenRoomSchema = dateRange.and(
  z.object({ roomId: z.string().uuid() }),
);

export type ReopenRoomInput = z.infer<typeof reopenRoomSchema>;

/**
 * Reopen a room type. Soft-deletes, like `clearRestrictions` — the panel still
 * has to be able to say who closed the dates and when after they reopen.
 */
export async function reopenRoomType(
  input: ReopenRoomInput,
): Promise<ActionResult> {
  const parsed = reopenRoomSchema.safeParse(input);
  if (!parsed.success) return failed(parsed.error.issues[0].message);
  const data = parsed.data;

  const session = await requireSession();
  if (!(await userOwnsRoom(session, data.roomId))) {
    return failed("Room type not found");
  }

  const rows = await query<{ id: string }>(
    `UPDATE room_closures
     SET is_active = FALSE
     WHERE room_id = $1
       AND is_active
       AND start_date <= $3::date
       AND end_date   >= $2::date
     RETURNING id`,
    [data.roomId, data.startDate, data.endDate],
  );

  revalidatePath(ROUTE);
  return { ok: true, affected: rows.length };
}

// ─────────────────────────────────────────────
// Publish — staged edits, applied as one unit
// ─────────────────────────────────────────────

const dates = z.array(isoDate).min(1).max(370);

/**
 * One staged edit. The grid stages per cell; each change carries the set of
 * dates it covers, and publishing folds them into the ranges these tables
 * actually store.
 */
const ariChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("price"),
    ratePlanId: z.string().uuid(),
    dates,
    /** Null clears the override and lets the plan's BAR show through again. */
    price: z.number().int().min(0).nullable(),
    label: z.string().max(100).nullable().default(null),
  }),
  z.object({
    type: z.literal("closure"),
    ratePlanId: z.string().uuid(),
    dates,
    note: z.string().max(500).nullable().default(null),
    /** True reopens the dates instead of closing them. */
    remove: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("restriction"),
    ratePlanId: z.string().uuid(),
    dates,
    minStay: z.number().int().min(1).nullable().default(null),
    maxStay: z.number().int().min(1).nullable().default(null),
    closedToArrival: z.boolean().default(false),
    closedToDeparture: z.boolean().default(false),
    note: z.string().max(500).nullable().default(null),
    remove: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("roomClosure"),
    roomId: z.string().uuid(),
    dates,
    note: z.string().max(500).nullable().default(null),
    remove: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("inventoryBlock"),
    roomId: z.string().uuid(),
    dates,
    /** Units withheld from sale. Zero releases them. */
    blockedRooms: z.number().int().min(0),
    note: z.string().max(500).nullable().default(null),
  }),
]);

export type AriChange = z.infer<typeof ariChangeSchema>;

const publishSchema = z.object({
  propertyId: z.string().uuid(),
  /** The window the host was looking at — what `version` was computed over. */
  from: isoDate,
  to: isoDate,
  /** `AriGridData.version` from the grid the edits were made against. */
  version: z.string().min(1).max(64),
  changes: z.array(ariChangeSchema).min(1).max(500),
});

export type PublishInput = z.input<typeof publishSchema>;

export type PublishResult =
  | { ok: true; affected: number; version: string }
  | { ok: false; error: string; stale?: true; version?: string };

/**
 * Apply a draft in one transaction.
 *
 * Three properties this has to hold, and all three are why it is one function
 * rather than a loop over the single-range actions above:
 *
 * - **Atomic.** A host who closes a week and reprices it has made one
 *   decision. Half of it landing is worse than none of it landing, because the
 *   half that lands is live and sellable.
 * - **Checked per request.** Every id in the payload came from the client.
 *   Ownership is verified inside the transaction, against the same snapshot
 *   the writes use, so a plan cannot change hands between the check and the
 *   write.
 * - **Refused when stale.** The draft was made against a screen. If that
 *   screen has since changed, the host is publishing decisions about data they
 *   never saw.
 */
export async function publishAriChanges(
  input: PublishInput,
): Promise<PublishResult> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const data = parsed.data;

  if (data.to < data.from) {
    return { ok: false, error: "End date must not be before the start date" };
  }

  const session = await requireSession();
  const userId = session.user.id;

  try {
    const result = await withTransaction(async (client) => {
      const one = async <T>(text: string, values?: unknown[]): Promise<T | null> => {
        const res = await client.query(text, values);
        return (res.rows[0] ?? null) as T | null;
      };

      // Ownership first, and only once per distinct id: a 200-cell draft on
      // one rate plan should not run 200 identical checks.
      const roomIds = new Set<string>();
      const ratePlanIds = new Set<string>();
      for (const change of data.changes) {
        if ("roomId" in change) roomIds.add(change.roomId);
        else ratePlanIds.add(change.ratePlanId);
      }

      for (const roomId of roomIds) {
        if (!(await userOwnsRoom(session, roomId, { queryOne: one }))) {
          throw new PublishError("Room type not found");
        }
      }
      for (const ratePlanId of ratePlanIds) {
        if (!(await userOwnsRatePlan(session, ratePlanId, { queryOne: one }))) {
          throw new PublishError("Rate plan not found");
        }
      }

      // Read the version inside the transaction, so nothing can slip in
      // between the check and the writes it is guarding.
      const current = await one<{ version: string }>(VERSION_SQL, [
        userId,
        data.propertyId,
        data.from,
        data.to,
      ]);
      const currentVersion = current?.version ?? "empty";
      if (currentVersion !== data.version) {
        throw new PublishError(
          "These dates changed while you were editing. Reload to see the current rates, then publish again.",
          { stale: true, version: currentVersion },
        );
      }

      let affected = 0;
      for (const change of data.changes) {
        affected += await applyChange(client, change, userId);
      }
      return affected;
    });

    revalidatePath(ROUTE);

    // Re-read outside the transaction: the caller needs the version its next
    // publish will be checked against.
    const after = await query<{ version: string }>(VERSION_SQL, [
      userId,
      data.propertyId,
      data.from,
      data.to,
    ]);

    return { ok: true, affected: result, version: after[0]?.version ?? "empty" };
  } catch (error) {
    if (error instanceof PublishError) {
      return { ok: false, error: error.message, ...error.detail };
    }
    throw error;
  }
}

/** Carries a refusal out of the transaction without committing it. */
class PublishError extends Error {
  readonly detail: { stale?: true; version?: string };
  constructor(message: string, detail: { stale?: true; version?: string } = {}) {
    super(message);
    this.detail = detail;
  }
}

type Client = Parameters<Parameters<typeof withTransaction>[0]>[0];

async function applyChange(
  client: Client,
  change: AriChange,
  userId: string,
): Promise<number> {
  const ranges = groupConsecutiveDates(change.dates);
  let affected = 0;

  for (const { start, end } of ranges) {
    switch (change.type) {
      case "price": {
        // Clearing and setting both start by retiring what covered the range:
        // a new row at the same priority would otherwise tie with the old one
        // and resolve arbitrarily.
        const cleared = await client.query(
          `UPDATE rate_overrides
             SET is_active = FALSE
           WHERE rate_plan_id = $1 AND is_active
             AND start_date <= $3::date AND end_date >= $2::date
           RETURNING id`,
          [change.ratePlanId, start, end],
        );
        affected += cleared.rowCount ?? 0;

        if (change.price !== null) {
          const inserted = await client.query(
            `INSERT INTO rate_overrides
               (rate_plan_id, label, start_date, end_date, price_per_night, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [change.ratePlanId, change.label, start, end, change.price, userId],
          );
          affected += inserted.rowCount ?? 0;
        }
        break;
      }

      case "closure": {
        if (change.remove) {
          const reopened = await client.query(
            `UPDATE rate_plan_restrictions
               SET is_active = FALSE
             WHERE rate_plan_id = $1 AND is_active AND is_closed
               AND start_date <= $3::date AND end_date >= $2::date
             RETURNING id`,
            [change.ratePlanId, start, end],
          );
          affected += reopened.rowCount ?? 0;
          break;
        }
        const closed = await client.query(
          `INSERT INTO rate_plan_restrictions
             (rate_plan_id, start_date, end_date, is_closed, note, created_by)
           VALUES ($1, $2, $3, TRUE, $4, $5)
           RETURNING id`,
          [change.ratePlanId, start, end, change.note, userId],
        );
        affected += closed.rowCount ?? 0;
        break;
      }

      case "restriction": {
        if (change.remove) {
          const lifted = await client.query(
            `UPDATE rate_plan_restrictions
               SET is_active = FALSE
             WHERE rate_plan_id = $1 AND is_active AND NOT is_closed
               AND start_date <= $3::date AND end_date >= $2::date
             RETURNING id`,
            [change.ratePlanId, start, end],
          );
          affected += lifted.rowCount ?? 0;
          break;
        }
        const set = await client.query(
          `INSERT INTO rate_plan_restrictions
             (rate_plan_id, start_date, end_date, is_closed,
              min_stay, max_stay, closed_to_arrival, closed_to_departure, note, created_by)
           VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            change.ratePlanId,
            start,
            end,
            change.minStay,
            change.maxStay,
            change.closedToArrival,
            change.closedToDeparture,
            change.note,
            userId,
          ],
        );
        affected += set.rowCount ?? 0;
        break;
      }

      case "roomClosure": {
        if (change.remove) {
          const reopened = await client.query(
            `UPDATE room_closures
               SET is_active = FALSE
             WHERE room_id = $1 AND is_active
               AND start_date <= $3::date AND end_date >= $2::date
             RETURNING id`,
            [change.roomId, start, end],
          );
          affected += reopened.rowCount ?? 0;
          break;
        }
        const closed = await client.query(
          `INSERT INTO room_closures (room_id, start_date, end_date, note, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [change.roomId, start, end, change.note, userId],
        );
        affected += closed.rowCount ?? 0;
        break;
      }

      case "inventoryBlock": {
        // room_inventory is sparse and keyed per date, so this is the one
        // change that genuinely writes a row per day.
        const written = await client.query(
          `INSERT INTO room_inventory
             (room_id, date, blocked_rooms, note, updated_by, updated_at)
           SELECT $1, d::date, $4, $5, $6, now()
           FROM generate_series($2::date, $3::date, INTERVAL '1 day') AS d
           ON CONFLICT (room_id, date) DO UPDATE SET
             blocked_rooms = EXCLUDED.blocked_rooms,
             note          = EXCLUDED.note,
             updated_by    = EXCLUDED.updated_by,
             updated_at    = now()
           RETURNING id`,
          [change.roomId, start, end, change.blockedRooms, change.note, userId],
        );
        affected += written.rowCount ?? 0;
        break;
      }
    }
  }

  return affected;
}
