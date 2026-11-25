import { AppStructureSchema, type AppStructure } from "@openbookings/apps-contract";
import type { CoreClient } from "../core-client";
import type { Queryable } from "../db/migrate";
import { type AppInstallation, installationByHotelCode } from "../installations";
import { type OtaError, hotelNotFound, invalidRequest, temporarilyUnavailable } from "../soap/errors";

export const STRUCTURE_MAX_AGE_MS = 10 * 60 * 1000;
/** SiteMinder waits on this reply (a hotelier is looking at the mapping screen): well inside its 1-2 s budget. */
export const STRUCTURE_FETCH_TIMEOUT_MS = 1_500;

/**
 * The `RoomStays` content of `OTA_HotelAvailRS`. SiteMinder wants every room/rate combination in its own
 * `RoomStay`, with unique names, so a rate plan's name carries its room's name. No `Occupancy`: the docs mark it
 * "Only for OBP" (reference_rooms-and-rates.md), and we use Per Day Pricing.
 */
export function roomsAndRatesPayload(s: AppStructure): Record<string, unknown> {
  const stays = s.rooms.flatMap((room) => {
    return room.ratePlans.map((plan) => {
      const planName = `${room.name} – ${plan.name}`;
      return {
        RoomTypes: {
          RoomType: {
            "@_RoomTypeCode": room.code,
            RoomDescription: { "@_Name": room.name, Text: room.name },
          },
        },
        RatePlans: {
          RatePlan: {
            "@_RatePlanCode": plan.code,
            RatePlanDescription: { "@_Name": planName, Text: planName },
          },
        },
      };
    });
  });
  return { RoomStays: { RoomStay: stays } };
}

type StructureRow = { structure: unknown; structure_fetched_at: Date | string | null };

/**
 * The property's structure, from `installations.structure` while it is under 10 minutes old, else fetched
 * from core and cached. A failed refresh serves the cached copy however old; with no copy it throws.
 */
export async function structureFor(
  db: Queryable,
  inst: AppInstallation,
  client: Pick<CoreClient, "structure">,
  now: Date,
): Promise<AppStructure> {
  const { rows } = await db.query<StructureRow>(
    `SELECT structure, structure_fetched_at FROM siteminder.installations WHERE id = $1`,
    [inst.id],
  );
  const row = rows[0];
  const parsed = row?.structure == null ? null : AppStructureSchema.safeParse(row.structure);
  const cached = parsed?.success ? parsed.data : null;
  const fetchedAt = row?.structure_fetched_at ? new Date(row.structure_fetched_at).getTime() : Number.NaN;
  if (cached && now.getTime() - fetchedAt < STRUCTURE_MAX_AGE_MS) return cached;

  try {
    const fresh = await client.structure({ timeoutMs: STRUCTURE_FETCH_TIMEOUT_MS });
    await db.query(`UPDATE siteminder.installations SET structure = $2::jsonb, structure_fetched_at = $3 WHERE id = $1`, [
      inst.id,
      JSON.stringify(fresh),
      now.toISOString(),
    ]);
    return fresh;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

/** The cached structure as stored (however old), or null when none was ever fetched. Never calls core. */
export async function cachedStructure(db: Queryable, installationId: string): Promise<AppStructure | null> {
  const { rows } = await db.query<{ structure: unknown }>(`SELECT structure FROM siteminder.installations WHERE id = $1`, [installationId]);
  const raw = rows[0]?.structure;
  if (raw == null) return null;
  const parsed = AppStructureSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type HotelAvailOutcome = { success: true; payload: Record<string, unknown> } | { success: false; errors: OtaError[] };

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The HotelCode of the request's first `HotelRef`, or undefined when the request has none. */
export function hotelCodeOf(body: Record<string, unknown>): string | undefined {
  const segments = isRecord(body.AvailRequestSegments) ? asArray(body.AvailRequestSegments.AvailRequestSegment) : [];
  for (const segment of segments) {
    const criteria = isRecord(segment) && isRecord(segment.HotelSearchCriteria) ? asArray(segment.HotelSearchCriteria.Criterion) : [];
    for (const criterion of criteria) {
      const ref = isRecord(criterion) ? criterion.HotelRef : undefined;
      const code = isRecord(ref) ? ref["@_HotelCode"] : undefined;
      if (typeof code === "string" && code !== "") return code;
    }
  }
  return undefined;
}

/** Answer one `OTA_HotelAvailRQ` (Rooms and Rates). Never throws for a backend failure: that becomes an OTA error. */
export async function answerHotelAvail(
  body: Record<string, unknown>,
  deps: { db: Queryable; clientFor: (inst: AppInstallation) => Pick<CoreClient, "structure">; now: Date },
): Promise<HotelAvailOutcome> {
  const code = hotelCodeOf(body);
  if (code === undefined) return { success: false, errors: [invalidRequest("Attribute HotelCode must exist")] };
  const inst = await installationByHotelCode(deps.db, code);
  if (!inst) return { success: false, errors: [hotelNotFound(code)] };
  try {
    const structure = await structureFor(deps.db, inst, deps.clientFor(inst), deps.now);
    return { success: true, payload: roomsAndRatesPayload(structure) };
  } catch (e) {
    console.error(`siteminder: rooms and rates for ${code} failed: ${e instanceof Error ? e.message : String(e)}`);
    return { success: false, errors: [temporarilyUnavailable()] };
  }
}
