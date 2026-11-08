import type { SelectedRoom } from "./quote";
import { MAX_ADULTS, MAX_CHILDREN, MAX_ROOMS } from "./stay-input";

/** The body of `POST /api/booking-intents`, after shape checks. Prices and stay rules are `priceSelection`'s job. */
export type IntentRequest = {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  rooms: SelectedRoom[];
  /** The total the guest was shown, in euros. */
  expectedTotal: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const wholeIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function parseIntentRequest(body: unknown): { ok: true; value: IntentRequest } | { ok: false; errors: string[] } {
  if (!isObject(body)) return { ok: false, errors: ["body must be a JSON object"] };
  const errors: string[] = [];
  const { propertyId, checkIn, checkOut, rooms, expectedTotal } = body;

  if (typeof propertyId !== "string" || !UUID.test(propertyId)) errors.push("propertyId must be a property id");
  if (typeof checkIn !== "string" || !DATE.test(checkIn)) errors.push("checkIn must be YYYY-MM-DD");
  if (typeof checkOut !== "string" || !DATE.test(checkOut)) errors.push("checkOut must be YYYY-MM-DD");
  if (typeof expectedTotal !== "number" || !Number.isFinite(expectedTotal) || expectedTotal < 0) {
    errors.push("expectedTotal must be the total shown, in euros");
  }

  const selection: SelectedRoom[] = [];
  if (!Array.isArray(rooms) || rooms.length < 1 || rooms.length > MAX_ROOMS) {
    errors.push(`rooms must list 1 to ${MAX_ROOMS} rooms`);
  } else {
    rooms.forEach((room, n) => {
      if (
        !isObject(room) ||
        typeof room.roomId !== "string" ||
        !UUID.test(room.roomId) ||
        typeof room.ratePlanId !== "string" ||
        !UUID.test(room.ratePlanId) ||
        !wholeIn(room.adults, 1, MAX_ADULTS) ||
        !wholeIn(room.children ?? 0, 0, MAX_CHILDREN)
      ) {
        errors.push(`rooms[${n}] needs a roomId, a ratePlanId, at least one adult and a whole number of children`);
        return;
      }
      selection.push({
        roomId: room.roomId,
        ratePlanId: room.ratePlanId,
        adults: room.adults as number,
        children: (room.children ?? 0) as number,
      });
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      propertyId: propertyId as string,
      checkIn: checkIn as string,
      checkOut: checkOut as string,
      rooms: selection,
      expectedTotal: expectedTotal as number,
    },
  };
}
