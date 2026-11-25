import { describe, expect, it } from "bun:test";
import type { AppBooking } from "@openbookings/apps-contract";
import { availNotifToChanges } from "../src/ota/avail-notif";
import { buildResNotif } from "../src/ota/res-notif";
import { xmlParser } from "../src/soap/xml";
import { addDays, findReservation, limitMessage, parseHelperOutput, parseReservation, unitProblems } from "./e2e-local";

const booking: AppBooking = {
  bookingId: "b-2031",
  reference: "OB-B7B0-2A1C",
  version: 1,
  cancelled: false,
  createdAt: "2031-03-01T09:30:00.000Z",
  modifiedAt: "2031-03-01T09:30:00.000Z",
  checkIn: "2031-05-01",
  checkOut: "2031-05-03",
  booker: { givenName: "Anna", surname: "de Vries" },
  rooms: [
    {
      reservationId: "r1",
      roomCode: "R5EED2000001",
      ratePlanCode: "P5EED3000001",
      checkIn: "2031-05-01",
      checkOut: "2031-05-03",
      adults: 2,
      children: 0,
      infants: 0,
      cots: 0,
      extraBeds: 0,
      cancelled: false,
      nights: [
        { date: "2031-05-01", priceCents: 12345 },
        { date: "2031-05-02", priceCents: 12345 },
      ],
      touristTaxCents: 0,
      payAtPropertyCents: 0,
    },
  ],
  roomsTotalCents: 24690,
  touristTaxCents: 0,
  commissionCents: 1111,
};

/** A reservation exactly as the app sends it to SiteMinder. */
const sent = (status: "Commit" | "Modify" | "Cancel", hotelCode = "OBSEED000001", b: AppBooking = booking) =>
  buildResNotif({
    booking: status === "Cancel" ? { ...b, cancelled: true } : b,
    status,
    requestorId: "OBK",
    hotelCode,
    credentials: { username: "u", password: "p" },
    echoToken: "echo-2031",
    now: new Date("2031-03-01T09:31:00.000Z"),
  });

describe("addDays", () => {
  it("counts calendar days in UTC, across months and leap days", () => {
    expect(addDays("2031-01-31", 1)).toBe("2031-02-01");
    expect(addDays("2032-02-28", 1)).toBe("2032-02-29");
    expect(addDays("2031-03-30", 2)).toBe("2031-04-01");
    expect(addDays("2031-05-01", -1)).toBe("2031-04-30");
  });
});

describe("parseReservation", () => {
  it("reads status, UniqueID, hotel code and stay from a message the app built", () => {
    expect(parseReservation(sent("Commit"))).toEqual({
      status: "Commit",
      uniqueId: "OBB7B02A1C",
      hotelCode: "OBSEED000001",
      start: "2031-05-01",
      end: "2031-05-03",
    });
    expect(parseReservation(sent("Cancel"))?.status).toBe("Cancel");
  });

  it("is null for anything that is not a reservation", () => {
    expect(parseReservation("<OTA_HotelAvailNotifRQ/>")).toBeNull();
    expect(parseReservation("")).toBeNull();
  });
});

describe("findReservation", () => {
  const other = { ...booking, reference: "OB-0000-0001" };
  const received = [sent("Commit", "OBOTHER00001"), sent("Commit", "OBSEED000001", other), sent("Commit"), sent("Cancel")];

  it("matches on hotel and status, and on the booking when given", () => {
    expect(findReservation(received, { hotelCode: "OBSEED000001", status: "Commit" })?.uniqueId).toBe("OB00000001");
    expect(findReservation(received, { hotelCode: "OBSEED000001", status: "Commit", uniqueId: "OBB7B02A1C" })?.uniqueId).toBe("OBB7B02A1C");
    expect(findReservation(received, { hotelCode: "OBSEED000001", status: "Cancel", uniqueId: "OBB7B02A1C" })).not.toBeNull();
  });

  it("is null when nothing matches", () => {
    expect(findReservation(received, { hotelCode: "OBSEED000001", status: "Modify" })).toBeNull();
    expect(findReservation(received, { hotelCode: "OBSEED000001", status: "Cancel", uniqueId: "OB00000001" })).toBeNull();
    expect(findReservation([], { hotelCode: "OBSEED000001", status: "Commit" })).toBeNull();
  });
});

describe("limitMessage", () => {
  it("is an availability message the app accepts, one limit per night", () => {
    const xml = limitMessage({
      hotelCode: "OBSEED000001",
      room: "R5EED2000001",
      rate: "P5EED3000001",
      limits: [
        { date: "2031-05-01", limit: 4 },
        { date: "2031-05-02", limit: 3 },
      ],
    });
    const body = (xmlParser.parse(xml) as Record<string, Record<string, unknown>>).OTA_HotelAvailNotifRQ!;
    expect(availNotifToChanges(body)).toEqual({
      hotelCode: "OBSEED000001",
      inventory: [
        { roomCode: "R5EED2000001", from: "2031-05-01", to: "2031-05-01", unitsLeft: 4 },
        { roomCode: "R5EED2000001", from: "2031-05-02", to: "2031-05-02", unitsLeft: 3 },
      ],
      restrictions: [],
    });
  });
});

describe("unitProblems", () => {
  const nights = [
    { date: "2031-05-01", bookable: 4, limit: 5 },
    { date: "2031-05-02", bookable: 3, limit: 5 },
  ];

  it("is empty when every night matches", () => {
    expect(unitProblems(nights, new Map([["2031-05-01", 4], ["2031-05-02", 3]]))).toEqual([]);
  });

  it("names each night that is off, and nights that are missing", () => {
    expect(unitProblems(nights, new Map([["2031-05-01", 4], ["2031-05-02", 4], ["2031-05-03", 4]]))).toEqual([
      "2031-05-02: 3 left, expected 4",
      "2031-05-03: missing",
    ]);
  });
});

describe("parseHelperOutput", () => {
  it("takes the JSON from the last result line, ignoring other output", () => {
    expect(parseHelperOutput('[db] connected\nE2E_RESULT {"a":1}\nnoise\nE2E_RESULT {"a":2}\n')).toEqual({ a: 2 });
    expect(parseHelperOutput("E2E_RESULT null")).toBeNull();
  });

  it("throws when the helper printed no result", () => {
    expect(() => parseHelperOutput("Error: boom\n")).toThrow("no result");
  });
});
