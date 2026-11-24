import type { AppBooking, AppBookingRoom, AppName } from "@openbookings/apps-contract";
import { type Credentials, OTA_NAMESPACE, PASSWORD_TEXT, SOAP_NAMESPACE, otaTimeStamp } from "../soap/envelope";
import { toXml } from "../soap/xml";

const WSSE_NAMESPACE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
const EUR = "EUR";
/** Fee Tax Type (FTT) 3 = "City tax" in SiteMinder's reference table; our tourist tax. */
const CITY_TAX = "3";
const PAID_COMMENT = "Paid in full online via OpenBookings. Cots and extra beds are payable at the hotel.";

export type ResStatus = "Commit" | "Modify" | "Cancel";

/** Integer cents as a decimal string with two decimals ("186.50"), by string slicing only: no floating point. */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`not a whole, non-negative number of cents: ${cents}`);
  const digits = String(cents).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** The day after a `YYYY-MM-DD` date, on the string itself (dates never go through JS `Date`). */
export function nextDay(date: string): string {
  const match = DATE.exec(date);
  if (!match) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  let year = Number(match[1]);
  let month = Number(match[2]);
  let day = Number(match[3]) + 1;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (daysInMonth === undefined || day - 1 < 1 || day - 1 > daysInMonth) throw new Error(`not a calendar date: ${date}`);
  if (day > daysInMonth) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * `total` split in proportion to `weights` with largest-remainder rounding, so the parts always sum to `total`
 * (ties go to the earlier part). All-zero weights split evenly. BigInt keeps the products exact.
 */
export function allocateCents(total: number, weights: number[]): number[] {
  const ws = weights.reduce((a, b) => a + b, 0) === 0 ? weights.map(() => 1n) : weights.map(BigInt);
  const sum = ws.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return [];
  const t = BigInt(total);
  const parts = ws.map((w) => (t * w) / sum);
  const remainders = ws.map((w, i) => ({ i, r: (t * w) % sum }));
  let left = t - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    parts[i] = (parts[i] as bigint) + 1n;
    left -= 1n;
  }
  return parts.map(Number);
}

/** `Surname` is mandatory: a booker with only one name is sent as that surname (as `appName` does in core). */
function personName(name: AppName): { GivenName: string; Surname: string } {
  if (name.surname.trim() !== "") return { GivenName: name.givenName, Surname: name.surname };
  return { GivenName: "", Surname: name.givenName.trim() || "Guest" };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Cots and extra beds (paid at the hotel) and infants (not in GuestCounts) only reach the hotel as text. */
function roomComment(room: AppBookingRoom): string | undefined {
  const parts: string[] = [];
  const extras = [
    ...(room.cots > 0 ? [plural(room.cots, "cot", "cots")] : []),
    ...(room.extraBeds > 0 ? [plural(room.extraBeds, "extra bed", "extra beds")] : []),
  ];
  if (extras.length > 0) {
    const amount = room.payAtPropertyCents > 0 ? `: ${EUR} ${centsToDecimal(room.payAtPropertyCents)}` : "";
    parts.push(`${extras.join(", ")}, payable at the hotel${amount}.`);
  }
  if (room.infants > 0) parts.push(`${plural(room.infants, "infant", "infants")} under 2, not in the guest counts.`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

const roomPriceCents = (room: AppBookingRoom) => room.nights.reduce((sum, n) => sum + n.priceCents, 0);

/** A `Total` with the tourist tax itemised as City Tax; the tax is part of the amount, so it is `inclusive`. */
function total(amountCents: number, touristTaxCents: number): Record<string, unknown> {
  return {
    "@_AmountAfterTax": centsToDecimal(amountCents),
    "@_CurrencyCode": EUR,
    ...(touristTaxCents > 0
      ? { Taxes: { Tax: { "@_Type": "inclusive", "@_Code": CITY_TAX, "@_Amount": centsToDecimal(touristTaxCents), "@_CurrencyCode": EUR } } }
      : {}),
  };
}

function roomStay(room: AppBookingRoom, rph: number, commissionCents: number, hotelCode: string): Record<string, unknown> {
  const nights = [...room.nights].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const comment = roomComment(room);
  return {
    RatePlans: {
      RatePlan: {
        "@_RatePlanCode": room.ratePlanCode,
        // Mandatory element; AppBooking carries no rate plan name, so the code stands in.
        RatePlanDescription: room.ratePlanCode,
        Commission: { CommissionPayableAmount: { "@_Amount": centsToDecimal(commissionCents), "@_CurrencyCode": EUR } },
      },
    },
    RoomRates: {
      RoomRate: {
        "@_RoomTypeCode": room.roomCode,
        "@_RatePlanCode": room.ratePlanCode,
        "@_NumberOfUnits": "1",
        Rates: {
          Rate: nights.map((n) => ({
            "@_UnitMultiplier": "1",
            "@_RateTimeUnit": "Day",
            "@_EffectiveDate": n.date,
            "@_ExpireDate": nextDay(n.date),
            Base: { "@_AmountAfterTax": centsToDecimal(n.priceCents), "@_CurrencyCode": EUR },
          })),
        },
      },
    },
    GuestCounts: {
      GuestCount: [
        { "@_AgeQualifyingCode": "10", "@_Count": String(room.adults) },
        ...(room.children > 0 ? [{ "@_AgeQualifyingCode": "8", "@_Count": String(room.children) }] : []),
      ],
    },
    TimeSpan: { "@_Start": room.checkIn, "@_End": room.checkOut },
    Total: total(roomPriceCents(room) + room.touristTaxCents, room.touristTaxCents),
    BasicPropertyInfo: { "@_HotelCode": hotelCode },
    ResGuestRPHs: { ResGuestRPH: { "@_RPH": String(rph) } },
    ...(comment === undefined ? {} : { Comments: { Comment: { Text: comment } } }),
  };
}

const customerProfile = (name: AppName) => ({ ProfileInfo: { Profile: { "@_ProfileType": "1", Customer: { PersonName: personName(name) } } } });

/**
 * A complete minified `OTA_HotelResNotifRQ` SOAP request with the WS-Security header.
 *
 * Rooms: Commit and Modify send the rooms not cancelled; Cancel sends every room (SiteMinder wants the full
 * original reservation). A Commit of a booking whose rooms are all cancelled (cancelled before SiteMinder ever
 * acknowledged it, followed by a Cancel) sends every room too, since a reservation needs at least one RoomStay.
 * Totals are summed from the rooms sent; the booking's current commission is split over them by room price.
 * `DepositPayments` (the docs' card-less "Deposit Only" form) states the online payment only when every room
 * sent is still booked: what is kept after a cancellation is not known here.
 */
export function buildResNotif(i: {
  booking: AppBooking;
  status: ResStatus;
  requestorId: string;
  hotelCode: string;
  credentials: Credentials;
  echoToken: string;
  now: Date;
}): string {
  const { booking, status } = i;
  if (booking.rooms.length === 0) throw new Error(`booking ${booking.reference} has no rooms`);
  const active = booking.rooms.filter((r) => !r.cancelled);
  if (status === "Modify" && active.length === 0) throw new Error(`booking ${booking.reference}: a Modify with its rooms all cancelled is a Cancel`);
  const rooms = status === "Cancel" || active.length === 0 ? booking.rooms : active;
  const allBooked = rooms.every((r) => !r.cancelled);
  if (rooms.some((r) => r.adults < 1)) throw new Error(`booking ${booking.reference} has a room with no adults`);

  const commissions = allocateCents(booking.commissionCents, rooms.map(roomPriceCents));
  const touristTaxCents = rooms.reduce((sum, r) => sum + r.touristTaxCents, 0);
  const totalCents = rooms.reduce((sum, r) => sum + roomPriceCents(r) + r.touristTaxCents, 0);
  // What the hotel is told must be what the guest paid. Only checked when the rooms sent are the booked ones: a
  // Cancel, or the Commit of a booking cancelled before SiteMinder had it, lists cancelled rooms on purpose.
  const sendsBookedRooms = status !== "Cancel" && !booking.cancelled && active.length > 0;
  if (sendsBookedRooms && totalCents !== booking.roomsTotalCents + booking.touristTaxCents) {
    throw new Error(
      `booking ${booking.reference}: room totals ${totalCents} differ from the booking's totals ${booking.roomsTotalCents} + ${booking.touristTaxCents}`,
    );
  }

  const reservation = {
    "@_CreateDateTime": booking.createdAt,
    ...(status === "Commit" ? {} : { "@_LastModifyDateTime": booking.modifiedAt }),
    UniqueID: { "@_Type": "14", "@_ID": booking.reference.replaceAll("-", "") },
    RoomStays: { RoomStay: rooms.map((room, n) => roomStay(room, n + 1, commissions[n] as number, i.hotelCode)) },
    ResGuests: {
      ResGuest: rooms.map((_, n) => ({
        "@_ResGuestRPH": String(n + 1),
        "@_PrimaryIndicator": n === 0 ? "1" : "0",
        Profiles: customerProfile(booking.booker),
      })),
    },
    ResGlobalInfo: {
      HotelReservationIDs: { HotelReservationID: { "@_ResID_Type": "14", "@_ResID_Value": booking.reference } },
      Comments: { Comment: { Text: PAID_COMMENT } },
      Total: {
        "@_CurrencyCode": EUR,
        ...total(totalCents, touristTaxCents),
        // Amounts are what the guest paid, commission included (gross).
        TPA_Extensions: { Total: { "@_includesCommission": "true" } },
      },
      ...(allBooked
        ? { DepositPayments: { GuaranteePayment: { AmountPercent: { "@_Amount": centsToDecimal(totalCents), "@_CurrencyCode": EUR } } } }
        : {}),
      Profiles: customerProfile(booking.booker),
    },
  };

  const message = {
    "@_xmlns": OTA_NAMESPACE,
    "@_ResStatus": status,
    "@_EchoToken": i.echoToken,
    "@_TimeStamp": otaTimeStamp(i.now),
    "@_Version": "1.0",
    POS: {
      Source: {
        RequestorID: { "@_Type": "22", "@_ID": i.requestorId },
        BookingChannel: { "@_Primary": "true", CompanyName: { "@_Code": i.requestorId, "#text": "OpenBookings" } },
      },
    },
    HotelReservations: { HotelReservation: reservation },
  };

  return toXml("SOAP-ENV:Envelope", {
    "@_xmlns:SOAP-ENV": SOAP_NAMESPACE,
    "SOAP-ENV:Header": {
      "wsse:Security": {
        "@_xmlns:wsse": WSSE_NAMESPACE,
        "@_SOAP-ENV:mustUnderstand": "1",
        "wsse:UsernameToken": {
          "wsse:Username": i.credentials.username,
          "wsse:Password": { "@_Type": PASSWORD_TEXT, "#text": i.credentials.password },
        },
      },
    },
    "SOAP-ENV:Body": { OTA_HotelResNotifRQ: message },
  });
}
