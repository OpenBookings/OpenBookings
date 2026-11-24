import type { InventoryChange, RestrictionChange } from "@openbookings/apps-contract";
import type { OtaError } from "../soap/errors";
import { asArray, asNode, attr, fail, isRecord, single, statusControl } from "./status-control";

type RestrictionFields = Omit<RestrictionChange, "ratePlanCode" | "from" | "to">;
type StayField = "minStayArrival" | "maxStayArrival" | "minStayThrough" | "maxStayThrough";

const STAY_FIELDS: Record<string, { field: StayField; isMax: boolean }> = {
  SetMinLOS: { field: "minStayArrival", isMax: false },
  SetMaxLOS: { field: "maxStayArrival", isMax: true },
  SetForwardMinStay: { field: "minStayThrough", isMax: false },
  SetForwardMaxStay: { field: "maxStayThrough", isMax: true },
};
const MAX_STAY_NIGHTS = 9999; // the docs' range for Time
const MAX_UNITS = 2_147_483_647; // the core stores units in an integer column

/** `BookingLimit` as units left to sell. The docs forbid arbitrary limits, so huge values are capped, not refused. */
function unitsLeft(limit: string): number | undefined {
  if (!/^\d+$/.test(limit)) return undefined;
  return Math.min(Number(limit), MAX_UNITS);
}

/**
 * Only the restrictions the message carries, so the core's patch semantics keep everything else
 * (a CTA-only message must not touch min stay or stop sell).
 */
function restrictionFields(message: Record<string, unknown>): RestrictionFields | { error: OtaError } {
  const fields: RestrictionFields = {};
  for (const node of asArray(message.RestrictionStatus).map(asNode)) {
    const status = attr(node, "Status");
    if (status !== "Open" && status !== "Close") return fail(`RestrictionStatus Status must be Open or Close, got "${status ?? ""}"`);
    const closed = status === "Close";
    const restriction = attr(node, "Restriction");
    // Without Restriction it is a stop sell; we keep stop sell per rate plan rather than zeroing availability.
    if (restriction === undefined) fields.closed = closed;
    else if (restriction === "Arrival") fields.closedToArrival = closed;
    else if (restriction === "Departure") fields.closedToDeparture = closed;
    else return fail(`Unsupported RestrictionStatus Restriction "${restriction}"`);
  }

  const lengths = asArray(message.LengthsOfStay).flatMap((group) => (isRecord(group) ? asArray(group.LengthOfStay) : []));
  for (const node of lengths.map(asNode)) {
    const type = attr(node, "MinMaxMessageType") ?? "";
    const stay = STAY_FIELDS[type];
    if (!stay) return fail(`Unsupported MinMaxMessageType "${type}"`);
    const time = attr(node, "Time");
    if (time === undefined) {
      // The docs: a max stay without Time clears it; a min stay always carries Time (1 at least).
      if (!stay.isMax) return fail(`Attribute Time must exist for ${type}`);
      fields[stay.field] = null;
      continue;
    }
    const nights = /^\d+$/.test(time) ? Number(time) : Number.NaN;
    if (!(nights <= MAX_STAY_NIGHTS)) return fail(`Time must be a whole number of nights up to ${MAX_STAY_NIGHTS}, got "${time}"`);
    fields[stay.field] = nights === 0 ? null : nights;
  }
  return fields;
}

/**
 * `OTA_HotelAvailNotifRQ` → ARI changes. `BookingLimit` sets the room's units left (rate plan ignored: our
 * inventory is per room type, last write wins); restrictions apply to the rate plan. Pure: codes are checked by
 * the core, the hotel by the caller.
 */
export function availNotifToChanges(
  body: Record<string, unknown>,
): { hotelCode: string; inventory: InventoryChange[]; restrictions: RestrictionChange[] } | { error: OtaError } {
  const container = single(body, "AvailStatusMessages");
  if (!container) return fail("Node AvailStatusMessages must occur once");
  const hotelCode = attr(container, "HotelCode");
  if (!hotelCode) return fail("Attribute HotelCode must exist");
  const messages = asArray(container.AvailStatusMessage).map(asNode);
  if (messages.length === 0) return fail("Node AvailStatusMessage must exist");

  const inventory: InventoryChange[] = [];
  const restrictions: RestrictionChange[] = [];
  for (const message of messages) {
    const control = statusControl(message);
    if ("error" in control) return control;

    const limit = attr(message, "BookingLimit");
    if (limit !== undefined) {
      const units = unitsLeft(limit);
      if (units === undefined) return fail(`BookingLimit must be a whole number of rooms, got "${limit}"`);
      if (!control.invTypeCode) return fail("Attribute InvTypeCode must exist");
      for (const range of control.ranges) inventory.push({ roomCode: control.invTypeCode, ...range, unitsLeft: units });
    }

    const fields = restrictionFields(message);
    if ("error" in fields) return fields;
    if (Object.keys(fields).length > 0) {
      if (!control.ratePlanCode) return fail("Attribute RatePlanCode must exist");
      for (const range of control.ranges) restrictions.push({ ratePlanCode: control.ratePlanCode, ...range, ...fields });
    }
  }
  return { hotelCode, inventory, restrictions };
}
