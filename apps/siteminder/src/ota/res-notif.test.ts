import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { XMLValidator } from "fast-xml-parser";
import type { AppBooking, AppBookingRoom } from "@openbookings/apps-contract";
import { xmlParser } from "../soap/xml";
import { decimalToCents } from "./rate-amount-notif";
import { allocateCents, buildResNotif, centsToDecimal, nextDay } from "./res-notif";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "../../fixtures", name), "utf8");

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const node = (v: unknown): Node => {
  if (!isNode(v)) throw new Error(`expected an element, got ${JSON.stringify(v)}`);
  return v;
};

const credentials = { username: "ob-channel", password: "a&b<c>" };
const now = new Date("2031-04-01T12:00:00.000Z");

function room(over: Partial<AppBookingRoom> = {}): AppBookingRoom {
  return {
    reservationId: "r1",
    roomCode: "DBL2031",
    ratePlanCode: "BAR2031",
    checkIn: "2031-05-01",
    checkOut: "2031-05-03",
    adults: 2,
    children: 1,
    infants: 1,
    cots: 1,
    extraBeds: 0,
    cancelled: false,
    nights: [
      { date: "2031-05-01", priceCents: 18650 },
      { date: "2031-05-02", priceCents: 20000 },
    ],
    touristTaxCents: 600,
    payAtPropertyCents: 2500,
    ...over,
  };
}

const roomOne = room();
const roomTwo = room({
  reservationId: "r2",
  roomCode: "TWN2031",
  ratePlanCode: "NRF2031",
  adults: 1,
  children: 0,
  infants: 0,
  cots: 0,
  nights: [
    { date: "2031-05-01", priceCents: 20000 },
    { date: "2031-05-02", priceCents: 20000 },
  ],
  touristTaxCents: 400,
  payAtPropertyCents: 0,
});

function booking(over: Partial<AppBooking> = {}): AppBooking {
  return {
    bookingId: "b-2031",
    reference: "OB-B7B0-2A1C",
    version: 1,
    cancelled: false,
    createdAt: "2031-03-01T09:30:00.000Z",
    modifiedAt: "2031-03-02T10:45:00.000Z",
    checkIn: "2031-05-01",
    checkOut: "2031-05-03",
    booker: { givenName: "Anna", surname: "de Vries" },
    rooms: [roomOne, roomTwo],
    roomsTotalCents: 78650,
    touristTaxCents: 1000,
    commissionCents: 3539,
    ...over,
  };
}

const build = (b: AppBooking, status: "Commit" | "Modify" | "Cancel" = "Commit") =>
  buildResNotif({ booking: b, status, requestorId: "OBK", hotelCode: "HOTEL2031", credentials, echoToken: "echo-res-2031", now });

/** Builds the message, checks it is well-formed, and parses it back with the B2 parser. */
function parsed(b: AppBooking, status: "Commit" | "Modify" | "Cancel" = "Commit") {
  const xml = build(b, status);
  expect(XMLValidator.validate(xml)).toBe(true);
  const envelope = node(node(xmlParser.parse(xml)).Envelope);
  const rq = node(node(envelope.Body).OTA_HotelResNotifRQ);
  const reservation = node(node(rq.HotelReservations).HotelReservation);
  const roomStays = list(node(reservation.RoomStays).RoomStay).map(node);
  const global = node(reservation.ResGlobalInfo);
  return { xml, envelope, rq, reservation, roomStays, global };
}

const rates = (stay: Node) => list(node(node(node(stay.RoomRates).RoomRate).Rates).Rate).map(node);
const commission = (stay: Node) => node(node(node(node(stay.RatePlans).RatePlan).Commission).CommissionPayableAmount);
const personName = (profiles: unknown) => node(node(node(node(node(profiles).ProfileInfo).Profile).Customer).PersonName);

describe("centsToDecimal", () => {
  it("writes cents as a decimal string with two decimals, without floating point", () => {
    expect(centsToDecimal(18650)).toBe("186.50");
    expect(centsToDecimal(20000)).toBe("200.00");
    expect(centsToDecimal(0)).toBe("0.00");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(99)).toBe("0.99");
    expect(centsToDecimal(100)).toBe("1.00");
    expect(centsToDecimal(123456789)).toBe("1234567.89");
    expect(centsToDecimal(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
  });

  it("round-trips with the parser used for SiteMinder's incoming amounts", () => {
    for (let cents = 0; cents <= 100_000; cents += 7) expect(decimalToCents(centsToDecimal(cents))).toBe(cents);
  });

  it("refuses anything that is not a whole, non-negative number of cents", () => {
    expect(() => centsToDecimal(-1)).toThrow();
    expect(() => centsToDecimal(1.5)).toThrow();
    expect(() => centsToDecimal(Number.NaN)).toThrow();
    expect(() => centsToDecimal(2 ** 60)).toThrow();
  });
});

describe("nextDay", () => {
  it("steps over month, year and leap-day boundaries on plain YYYY-MM-DD strings", () => {
    expect(nextDay("2031-05-01")).toBe("2031-05-02");
    expect(nextDay("2031-04-30")).toBe("2031-05-01");
    expect(nextDay("2031-12-31")).toBe("2032-01-01");
    expect(nextDay("2031-02-28")).toBe("2031-03-01");
    expect(nextDay("2032-02-28")).toBe("2032-02-29");
    expect(nextDay("2032-02-29")).toBe("2032-03-01");
    expect(nextDay("2100-02-28")).toBe("2100-03-01");
    expect(nextDay("2400-02-28")).toBe("2400-02-29");
  });
});

describe("allocateCents", () => {
  it("splits in proportion with largest-remainder rounding so the parts sum exactly", () => {
    expect(allocateCents(3539, [38650, 40000])).toEqual([1739, 1800]);
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateCents(0, [5, 7])).toEqual([0, 0]);
    expect(allocateCents(10, [0, 5])).toEqual([0, 10]);
  });

  it("splits evenly when every weight is zero (free stays)", () => {
    expect(allocateCents(5, [0, 0])).toEqual([3, 2]);
  });

  it("always sums to the total", () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % max;
    };
    for (let i = 0; i < 500; i++) {
      const weights = Array.from({ length: 1 + rand(6) }, () => rand(500_000));
      const total = rand(100_000);
      const parts = allocateCents(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      for (const p of parts) expect(Number.isInteger(p) && p >= 0).toBe(true);
    }
  });
});

describe("buildResNotif: Commit of a two-room booking", () => {
  const { xml, envelope, rq, reservation, roomStays, global } = parsed(booking());

  it("is a SOAP request with the WS-Security UsernameToken (PasswordText) header", () => {
    expect(xml.startsWith('<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">')).toBe(true);
    expect(xml).toContain('<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" SOAP-ENV:mustUnderstand="1">');
    const token = node(node(node(envelope.Header).Security).UsernameToken);
    expect(token.Username).toBe("ob-channel");
    expect(token.Password).toEqual({
      "#text": "a&b<c>",
      "@_Type": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText",
    });
    expect(xml).not.toMatch(/>\s+</); // minified
  });

  it("carries status, echo token, timestamp, version and namespace on the root", () => {
    expect(xml).toContain('<OTA_HotelResNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05" ');
    expect(rq["@_ResStatus"]).toBe("Commit");
    expect(rq["@_EchoToken"]).toBe("echo-res-2031");
    expect(rq["@_TimeStamp"]).toBe("2031-04-01T12:00:00Z");
    expect(rq["@_Version"]).toBe("1.0");
  });

  it("identifies the channel, the reservation and its creation time", () => {
    const source = node(node(rq.POS).Source);
    expect(source.RequestorID).toEqual({ "@_Type": "22", "@_ID": "OBK" });
    expect(node(source.BookingChannel)["@_Primary"]).toBe("true");
    expect(node(node(source.BookingChannel).CompanyName)).toEqual({ "@_Code": "OBK", "#text": "OpenBookings" });
    expect(reservation.UniqueID).toEqual({ "@_Type": "14", "@_ID": "OBB7B02A1C" });
    expect(reservation["@_CreateDateTime"]).toBe("2031-03-01T09:30:00.000Z");
    expect(reservation["@_LastModifyDateTime"]).toBeUndefined();
    expect(node(node(global.HotelReservationIDs).HotelReservationID)).toEqual({ "@_ResID_Type": "14", "@_ResID_Value": "OB-B7B0-2A1C" });
  });

  it("has one RoomStay per room with its codes, hotel and stay dates", () => {
    expect(roomStays).toHaveLength(2);
    const [one, two] = roomStays as [Node, Node];
    expect(node(node(one.RoomRates).RoomRate)).toMatchObject({ "@_RoomTypeCode": "DBL2031", "@_RatePlanCode": "BAR2031", "@_NumberOfUnits": "1" });
    expect(node(node(two.RoomRates).RoomRate)).toMatchObject({ "@_RoomTypeCode": "TWN2031", "@_RatePlanCode": "NRF2031", "@_NumberOfUnits": "1" });
    expect(node(node(one.RatePlans).RatePlan)["@_RatePlanCode"]).toBe("BAR2031");
    expect(one.TimeSpan).toEqual({ "@_Start": "2031-05-01", "@_End": "2031-05-03" });
    expect(one.BasicPropertyInfo).toEqual({ "@_HotelCode": "HOTEL2031" });
    expect(node(node(one.ResGuestRPHs).ResGuestRPH)["@_RPH"]).toBe("1");
    expect(node(node(two.ResGuestRPHs).ResGuestRPH)["@_RPH"]).toBe("2");
  });

  it("sends each night's price after tax exactly: 186.50 and 200.00 (Review Focus 1)", () => {
    expect(rates(roomStays[0] as Node)).toEqual([
      { "@_UnitMultiplier": "1", "@_RateTimeUnit": "Day", "@_EffectiveDate": "2031-05-01", "@_ExpireDate": "2031-05-02", Base: { "@_AmountAfterTax": "186.50", "@_CurrencyCode": "EUR" } },
      { "@_UnitMultiplier": "1", "@_RateTimeUnit": "Day", "@_EffectiveDate": "2031-05-02", "@_ExpireDate": "2031-05-03", Base: { "@_AmountAfterTax": "200.00", "@_CurrencyCode": "EUR" } },
    ]);
    expect(xml).toContain('AmountAfterTax="186.50"');
    expect(xml).toContain('AmountAfterTax="200.00"');
  });

  it("splits the booking's commission over the rooms by room price, summing exactly", () => {
    expect(commission(roomStays[0] as Node)).toEqual({ "@_Amount": "17.39", "@_CurrencyCode": "EUR" });
    expect(commission(roomStays[1] as Node)).toEqual({ "@_Amount": "18.00", "@_CurrencyCode": "EUR" });
    const sum = roomStays.map((s) => decimalToCents(commission(s)["@_Amount"] as string) ?? Number.NaN).reduce((a, b) => a + b, 0);
    expect(sum).toBe(3539);
  });

  it("adds tourist tax as City Tax (FTT 3) on each room total and on the reservation total", () => {
    expect(node((roomStays[0] as Node).Total)).toEqual({
      "@_AmountAfterTax": "392.50",
      "@_CurrencyCode": "EUR",
      Taxes: { Tax: { "@_Type": "inclusive", "@_Code": "3", "@_Amount": "6.00", "@_CurrencyCode": "EUR" } },
    });
    expect(node((roomStays[1] as Node).Total)).toMatchObject({ "@_AmountAfterTax": "404.00" });
    expect(node(global.Total)).toEqual({
      "@_CurrencyCode": "EUR",
      "@_AmountAfterTax": "796.50",
      Taxes: { Tax: { "@_Type": "inclusive", "@_Code": "3", "@_Amount": "10.00", "@_CurrencyCode": "EUR" } },
      TPA_Extensions: { Total: { "@_includesCommission": "true" } },
    });
  });

  it("counts adults (10) and children (8) but not infants", () => {
    expect(node((roomStays[0] as Node).GuestCounts).GuestCount).toEqual([
      { "@_AgeQualifyingCode": "10", "@_Count": "2" },
      { "@_AgeQualifyingCode": "8", "@_Count": "1" },
    ]);
    expect(node((roomStays[1] as Node).GuestCounts).GuestCount).toEqual({ "@_AgeQualifyingCode": "10", "@_Count": "1" });
    expect(xml).not.toContain('AgeQualifyingCode="7"');
  });

  it("mentions cots, extra beds and infants in the room comment, paid at the hotel", () => {
    expect(node(node((roomStays[0] as Node).Comments).Comment).Text).toBe(
      "1 cot, payable at the hotel: EUR 25.00. 1 infant under 2, not in the guest counts.",
    );
    expect((roomStays[1] as Node).Comments).toBeUndefined();
    expect(node(node(global.Comments).Comment).Text).toBe("Paid in full online via OpenBookings. Cots and extra beds are payable at the hotel.");
  });

  it("states the online payment as a card-less deposit of the full amount", () => {
    expect(global.DepositPayments).toEqual({ GuaranteePayment: { AmountPercent: { "@_Amount": "796.50", "@_CurrencyCode": "EUR" } } });
  });

  it("names the booker as customer and as the guest of every room, first and last name only", () => {
    const expectedName = { GivenName: "Anna", Surname: "de Vries" };
    expect(personName(global.Profiles)).toEqual(expectedName);
    expect(node(node(node(global.Profiles).ProfileInfo).Profile)["@_ProfileType"]).toBe("1");
    const guests = list(node(reservation.ResGuests).ResGuest).map(node);
    expect(guests.map((g) => [g["@_ResGuestRPH"], g["@_PrimaryIndicator"]])).toEqual([
      ["1", "1"],
      ["2", "0"],
    ]);
    for (const g of guests) expect(personName(g.Profiles)).toEqual(expectedName);
  });

  it("carries no card data, guarantee or contact details", () => {
    for (const forbidden of ["@", "CardNumber", "PaymentCard", "AcceptedPayment", "GuaranteesAccepted", "Email", "Telephone", "Address", "SeriesCode"]) {
      expect(xml).not.toContain(forbidden);
    }
    // `GuaranteePayment` is the mandatory wrapper of the card-less deposit; the `Guarantee` element itself is absent.
    expect(xml).not.toMatch(/<Guarantee[\s>/]/);
  });

  it("follows the element order and attribute names of SiteMinder's sample reservation", () => {
    const sample = node(xmlParser.parse(fixture("reservation-rq-max-content.xml")));
    // DepositPayments is not in the maximum-content sample; the docs list it right after Guarantee (Deposit Only tab).
    const deposit = node(xmlParser.parse(fixture("reservation-rq-deposit-only.xml")));
    const sampleGlobal = node(node(node(node(node(sample.Envelope).Body).OTA_HotelResNotifRQ).HotelReservations).HotelReservation).ResGlobalInfo;
    const withDeposit: Node = {};
    for (const [key, value] of Object.entries(node(sampleGlobal))) {
      withDeposit[key] = value;
      if (key === "Guarantee") withDeposit.DepositPayments = deposit.DepositPayments;
    }
    node(node(node(node(node(sample.Envelope).Body).OTA_HotelResNotifRQ).HotelReservations).HotelReservation).ResGlobalInfo = withDeposit;

    const ours = node(xmlParser.parse(xml));
    expect(structureProblems(ours, sample, "")).toEqual([]);
  });
});

/** Merges repeated elements so every attribute and child that any instance has is known, in first-seen order. */
function merged(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const out: Node = {};
  for (const item of value) {
    if (!isNode(item)) return item;
    for (const [k, v] of Object.entries(item)) out[k] = k in out ? [out[k], v].flat() : v;
  }
  return out;
}

/** Every element/attribute we send exists at the same path in the sample, and sibling elements keep the sample's order. */
function structureProblems(ours: unknown, sample: unknown, path: string): string[] {
  const problems: string[] = [];
  const theirs = merged(sample);
  for (const item of list(ours)) {
    if (!isNode(item)) {
      if (isNode(theirs) && !Object.keys(theirs).every((k) => k.startsWith("@_"))) problems.push(`${path}: text where the sample has elements`);
      continue;
    }
    if (!isNode(theirs)) {
      problems.push(`${path}: element content where the sample has text`);
      continue;
    }
    const sampleOrder = Object.keys(theirs).filter((k) => !k.startsWith("@_") && k !== "#text");
    let last = -1;
    for (const key of Object.keys(item)) {
      if (key === "#text") continue;
      if (key.startsWith("@_")) {
        if (key !== "@_xmlns" && !(key in theirs)) problems.push(`${path}/${key}: attribute not in the sample`);
        continue;
      }
      const at = sampleOrder.indexOf(key);
      if (at === -1) problems.push(`${path}/${key}: element not in the sample`);
      else if (at < last) problems.push(`${path}/${key}: out of the sample's order`);
      else {
        last = at;
        problems.push(...structureProblems(item[key], theirs[key], `${path}/${key}`));
      }
    }
  }
  return problems;
}

describe("buildResNotif: names (Review Focus 3)", () => {
  const nameOf = (b: AppBooking) => {
    const { global, reservation } = parsed(b);
    const guest = node(list(node(reservation.ResGuests).ResGuest)[0]);
    return { customer: personName(global.Profiles), guest: personName(guest.Profiles) };
  };

  it("escapes XML-special characters and keeps non-Latin text, parsing back to the original", () => {
    const names = nameOf(booking({ booker: { givenName: "O'Brien & Zoë <\"x\">", surname: "Ἀλέξανδρος" } }));
    expect(names.customer).toEqual({ GivenName: "O'Brien & Zoë <\"x\">", Surname: "Ἀλέξανδρος" });
    expect(names.guest).toEqual(names.customer);
  });

  it("sends a single-word name as the surname with an empty given name", () => {
    expect(nameOf(booking({ booker: { givenName: "", surname: "Madonna" } })).customer).toEqual({ GivenName: "", Surname: "Madonna" });
  });

  it("never sends an empty surname", () => {
    expect(nameOf(booking({ booker: { givenName: "Cher", surname: "  " } })).customer).toEqual({ GivenName: "", Surname: "Cher" });
    expect(nameOf(booking({ booker: { givenName: "", surname: "" } })).customer).toEqual({ GivenName: "", Surname: "Guest" });
  });

  it("escapes credentials too", () => {
    const xml = build(booking());
    expect(xml).toContain("<wsse:Password Type=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText\">a&amp;b&lt;c&gt;</wsse:Password>");
  });
});

describe("buildResNotif: Modify and Cancel", () => {
  const cancelledTwo = { ...roomTwo, cancelled: true };

  it("Modify leaves cancelled rooms out and totals what is left", () => {
    const { rq, reservation, roomStays, global } = parsed(
      booking({ version: 2, rooms: [roomOne, cancelledTwo], roomsTotalCents: 38650, touristTaxCents: 600, commissionCents: 1739 }),
      "Modify",
    );
    expect(rq["@_ResStatus"]).toBe("Modify");
    expect(reservation["@_CreateDateTime"]).toBe("2031-03-01T09:30:00.000Z");
    expect(reservation["@_LastModifyDateTime"]).toBe("2031-03-02T10:45:00.000Z");
    expect(roomStays).toHaveLength(1);
    expect(node(node((roomStays[0] as Node).RoomRates).RoomRate)["@_RoomTypeCode"]).toBe("DBL2031");
    expect(commission(roomStays[0] as Node)["@_Amount"]).toBe("17.39");
    expect(node(global.Total)["@_AmountAfterTax"]).toBe("392.50");
    expect(node(global.DepositPayments)).toEqual({ GuaranteePayment: { AmountPercent: { "@_Amount": "392.50", "@_CurrencyCode": "EUR" } } });
    expect(list(node(reservation.ResGuests).ResGuest)).toHaveLength(1);
  });

  it("Modify after an early departure sends the shortened stay", () => {
    const shortened = { ...roomOne, checkOut: "2031-05-02", nights: [{ date: "2031-05-01", priceCents: 18650 }], touristTaxCents: 300 };
    const { roomStays } = parsed(booking({ rooms: [shortened, roomTwo] }), "Modify");
    expect((roomStays[0] as Node).TimeSpan).toEqual({ "@_Start": "2031-05-01", "@_End": "2031-05-02" });
    expect(rates(roomStays[0] as Node).map((r) => [r["@_EffectiveDate"], r["@_ExpireDate"]])).toEqual([["2031-05-01", "2031-05-02"]]);
  });

  it("Cancel keeps every room with its original prices, the modify time, and no payment section", () => {
    const { xml, rq, reservation, roomStays, global } = parsed(
      booking({ version: 3, cancelled: true, rooms: [{ ...roomOne, cancelled: true }, cancelledTwo], roomsTotalCents: 0, touristTaxCents: 0, commissionCents: 0 }),
      "Cancel",
    );
    expect(rq["@_ResStatus"]).toBe("Cancel");
    expect(reservation["@_LastModifyDateTime"]).toBe("2031-03-02T10:45:00.000Z");
    expect(roomStays).toHaveLength(2);
    expect(rates(roomStays[0] as Node).map((r) => node(r.Base)["@_AmountAfterTax"])).toEqual(["186.50", "200.00"]);
    expect(node(global.Total)["@_AmountAfterTax"]).toBe("796.50");
    expect(roomStays.map((s) => commission(s)["@_Amount"])).toEqual(["0.00", "0.00"]);
    expect(global.DepositPayments).toBeUndefined();
    expect(xml).not.toMatch(/<Guarantee[\s>/]/);
  });

  it("Cancel states the commission the hotel still owes (non-refundable) over all rooms", () => {
    const { roomStays } = parsed(
      booking({ cancelled: true, rooms: [{ ...roomOne, cancelled: true }, cancelledTwo], roomsTotalCents: 0, touristTaxCents: 0, commissionCents: 3539 }),
      "Cancel",
    );
    expect(roomStays.map((s) => commission(s)["@_Amount"])).toEqual(["17.39", "18.00"]);
  });

  it("Commit of a booking cancelled before it was ever delivered still lists its rooms (Commit then Cancel)", () => {
    const { roomStays, global } = parsed(booking({ cancelled: true, rooms: [{ ...roomOne, cancelled: true }, cancelledTwo] }), "Commit");
    expect(roomStays).toHaveLength(2);
    expect(global.DepositPayments).toBeUndefined();
  });

  it("refuses a booking without rooms (SiteMinder needs at least one RoomStay)", () => {
    expect(() => build(booking({ rooms: [] }))).toThrow(/no rooms/);
  });
});
