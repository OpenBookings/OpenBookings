import type { AriBatch } from "@openbookings/apps-contract";
import type { Queryable } from "../db/migrate";
import { storeInbound } from "../inbox";
import { installationByHotelCode } from "../installations";
import { availNotifToChanges } from "../ota/avail-notif";
import { ignoredSingleGuestAmounts, rateAmountNotifToChanges } from "../ota/rate-amount-notif";
import { cachedStructure } from "../ota/rooms-and-rates";
import type { OtaRequest, buildResponse } from "./envelope";
import { type OtaError, hotelNotFound, invalidRequest, rateCodeNotFound, roomTypeNotFound } from "./errors";

type Content = Parameters<typeof buildResponse>[2];
export type NotifContext = { db: Queryable; now: Date; kickTick?: (installationId: string) => void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `OTA_HotelAvailNotifRQ` and `OTA_HotelRateAmountNotifRQ`: map (B5), check the hotel, store in the inbox, reply.
 * Core is never called while SiteMinder waits: the stored message is sent by a tick kicked after the reply is on its
 * way. A redelivered EchoToken is answered Success again without being stored twice.
 */
export async function handleNotif(request: OtaRequest, ctx: NotifContext): Promise<Content> {
  // The inbox keys messages by EchoToken; SiteMinder's are UUIDs (Integration Requirements, "EchoToken").
  if (!UUID.test(request.echoToken)) return { success: false, errors: [invalidRequest("EchoToken must be a UUID")] };

  const mapped = request.kind === "HotelAvailNotifRQ" ? availNotifToChanges(request.body) : rateAmountNotifToChanges(request.body);
  if ("error" in mapped) return { success: false, errors: [mapped.error] };
  const { hotelCode, ...changes } = mapped;

  const inst = await installationByHotelCode(ctx.db, hotelCode);
  if (!inst) return { success: false, errors: [hotelNotFound(hotelCode)] };

  if (request.kind === "HotelRateAmountNotifRQ") {
    const ignored = ignoredSingleGuestAmounts(request.body);
    if (ignored.length > 0) {
      console.info("[siteminder] ignored Single Guest Discount amounts (not offered)", { echoToken: request.echoToken, hotelCode, ignored });
    }
  }

  const count = Object.values(changes).reduce((n, list) => n + list.length, 0);
  if (count === 0) return { success: true }; // nothing to change, e.g. a message we only acknowledge

  const unknown = await unknownCodes(ctx.db, inst.id, changes);
  if (unknown.length > 0) return { success: false, errors: unknown };

  const stored = await storeInbound(ctx.db, { installationId: inst.id, echoToken: request.echoToken, kind: request.kind, changes, now: ctx.now });
  if (stored === "stored" && ctx.kickTick) {
    const kick = ctx.kickTick;
    queueMicrotask(() => kick(inst.id));
  }
  return { success: true };
}

/**
 * SiteMinder's mandatory 402 / 249 for codes the hotel's structure lacks, judged from the copy cached by Rooms and
 * Rates (SiteMinder only learns codes from that reply, so it is never older than the codes it can send). Messages
 * are atomic: with any unknown code nothing is stored. With no cached copy yet, core judges the codes later.
 */
async function unknownCodes(db: Queryable, installationId: string, changes: Partial<AriBatch>): Promise<OtaError[]> {
  const structure = await cachedStructure(db, installationId);
  if (!structure) return [];
  const rooms = new Set(structure.rooms.map((r) => r.code));
  const plans = new Set(structure.rooms.flatMap((r) => r.ratePlans.map((p) => p.code)));
  const errors: OtaError[] = [];
  if ((changes.inventory ?? []).some((c) => !rooms.has(c.roomCode))) errors.push(roomTypeNotFound());
  const planCodes = [...(changes.rates ?? []), ...(changes.restrictions ?? [])].map((c) => c.ratePlanCode);
  if (planCodes.some((code) => !plans.has(code))) errors.push(rateCodeNotFound());
  return errors;
}
