import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InventoryChangeSchema, RestrictionChangeSchema } from "@openbookings/apps-contract";
import { xmlParser } from "../soap/xml";
import { availNotifToChanges } from "./avail-notif";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "../../fixtures", name), "utf8");
const root = (xml: string) => (xmlParser.parse(xml) as Record<string, Record<string, unknown>>).OTA_HotelAvailNotifRQ!;

/** An OTA_HotelAvailNotifRQ body (as `parseEnvelope` hands it over) around the given AvailStatusMessage elements. */
const avail = (messages: string, hotel = ` HotelCode="SM-AV-2031"`) =>
  root(`<OTA_HotelAvailNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05" Version="1.0"><AvailStatusMessages${hotel}>${messages}</AvailStatusMessages></OTA_HotelAvailNotifRQ>`);
const control = (start = "2031-05-01", end = "2031-05-03", extra = "") =>
  `<StatusApplicationControl Start="${start}" End="${end}" InvTypeCode="RSGL2031" RatePlanCode="PBAR2031"${extra}/>`;
const msg = (inner: string, attrs = "", ctl = control()) => `<AvailStatusMessage${attrs}>${ctl}${inner}</AvailStatusMessage>`;
const dates = { from: "2031-05-01", to: "2031-05-03" };
const plan = { ratePlanCode: "PBAR2031", ...dates };

function ok(body: Record<string, unknown>) {
  const result = availNotifToChanges(body);
  if ("error" in result) throw new Error(`unexpected error: ${result.error.message}`);
  for (const c of result.inventory) InventoryChangeSchema.parse(c);
  for (const c of result.restrictions) RestrictionChangeSchema.parse(c);
  return result;
}
function fails(body: Record<string, unknown>) {
  const result = availNotifToChanges(body);
  if (!("error" in result)) throw new Error(`expected an error, got ${JSON.stringify(result)}`);
  return result.error;
}

describe("availNotifToChanges on SiteMinder's samples", () => {
  const day = { from: "2024-10-05", to: "2024-10-05" };

  it("maps the Stay on Arrival sample: availability, stop sell, min/max LOS, CTA and CTD", () => {
    expect(ok(root(fixture("availability-rq-stay-on-arrival.xml")))).toEqual({
      hotelCode: "HOTELCODE",
      inventory: [{ roomCode: "SGL", ...day, unitsLeft: 10 }],
      restrictions: [
        { ratePlanCode: "BAR", ...day, closed: false },
        { ratePlanCode: "BAR", ...day, minStayArrival: 1, maxStayArrival: 3 },
        { ratePlanCode: "BAR", ...day, closedToArrival: false },
        { ratePlanCode: "BAR", ...day, closedToDeparture: false },
      ],
    });
  });

  it("maps the Stay Through sample onto the through limits", () => {
    expect(ok(root(fixture("availability-rq-stay-through.xml")))).toEqual({
      hotelCode: "HOTELCODE",
      inventory: [{ roomCode: "SGL", ...day, unitsLeft: 10 }],
      restrictions: [
        { ratePlanCode: "BAR", ...day, closed: false },
        { ratePlanCode: "BAR", ...day, minStayThrough: 1, maxStayThrough: 3 },
        { ratePlanCode: "BAR", ...day, closedToArrival: false },
        { ratePlanCode: "BAR", ...day, closedToDeparture: false },
      ],
    });
  });
});

describe("partial messages (Review Focus 2)", () => {
  it("a message carrying only CTA yields a restriction with only closedToArrival set", () => {
    const { inventory, restrictions } = ok(avail(msg(`<RestrictionStatus Restriction="Arrival" Status="Close"/>`)));
    expect(inventory).toEqual([]);
    expect(restrictions).toHaveLength(1);
    expect(Object.keys(restrictions[0]!).sort()).toEqual(["closedToArrival", "from", "ratePlanCode", "to"]);
    expect(restrictions[0]).toEqual({ ...plan, closedToArrival: true });
  });

  it("a message carrying only CTD or only stop sell sets only that flag", () => {
    expect(ok(avail(msg(`<RestrictionStatus Restriction="Departure" Status="Close"/>`))).restrictions).toEqual([{ ...plan, closedToDeparture: true }]);
    expect(ok(avail(msg(`<RestrictionStatus Status="Close"/>`))).restrictions).toEqual([{ ...plan, closed: true }]);
  });

  it("a message carrying only a min stay sets only that limit", () => {
    const { restrictions } = ok(avail(msg(`<LengthsOfStay><LengthOfStay MinMaxMessageType="SetMinLOS" Time="2"/></LengthsOfStay>`)));
    expect(restrictions).toEqual([{ ...plan, minStayArrival: 2 }]);
  });

  it("BookingLimit without restrictions yields no restriction change", () => {
    expect(ok(avail(msg("", ` BookingLimit="4"`)))).toEqual({
      hotelCode: "SM-AV-2031",
      inventory: [{ roomCode: "RSGL2031", ...dates, unitsLeft: 4 }],
      restrictions: [],
    });
  });

  it("one message may carry BookingLimit, a RestrictionStatus and LengthsOfStay together", () => {
    const body = avail(
      msg(
        `<RestrictionStatus Status="Close"/><LengthsOfStay><LengthOfStay MinMaxMessageType="SetMinLOS" Time="2"/><LengthOfStay MinMaxMessageType="SetMaxLOS" Time="14"/></LengthsOfStay>`,
        ` BookingLimit="0"`,
      ),
    );
    expect(ok(body)).toEqual({
      hotelCode: "SM-AV-2031",
      inventory: [{ roomCode: "RSGL2031", ...dates, unitsLeft: 0 }],
      restrictions: [{ ...plan, closed: true, minStayArrival: 2, maxStayArrival: 14 }],
    });
  });

  it("several RestrictionStatus elements in one message all apply", () => {
    const body = avail(msg(`<RestrictionStatus Restriction="Arrival" Status="Close"/><RestrictionStatus Restriction="Departure" Status="Open"/>`));
    expect(ok(body).restrictions).toEqual([{ ...plan, closedToArrival: true, closedToDeparture: false }]);
  });

  it("a message with only a StatusApplicationControl changes nothing", () => {
    expect(ok(avail(msg("")))).toEqual({ hotelCode: "SM-AV-2031", inventory: [], restrictions: [] });
  });

  it("keeps the messages' order, one change per message", () => {
    const body = avail(
      msg(`<RestrictionStatus Status="Close"/>`, "", control("2031-05-01", "2031-05-01")) +
        msg(`<RestrictionStatus Status="Open"/>`, "", control("2031-05-02", "2031-05-02", "").replace("PBAR2031", "PNR2031")) +
        msg("", ` BookingLimit="7"`, control("2031-05-02", "2031-05-04")),
    );
    expect(ok(body)).toEqual({
      hotelCode: "SM-AV-2031",
      inventory: [{ roomCode: "RSGL2031", from: "2031-05-02", to: "2031-05-04", unitsLeft: 7 }],
      restrictions: [
        { ratePlanCode: "PBAR2031", from: "2031-05-01", to: "2031-05-01", closed: true },
        { ratePlanCode: "PNR2031", from: "2031-05-02", to: "2031-05-02", closed: false },
      ],
    });
  });
});

describe("stay limits", () => {
  const los = (inner: string) => avail(msg(`<LengthsOfStay>${inner}</LengthsOfStay>`));

  it("a max stay without Time clears it (null), per the docs", () => {
    expect(ok(los(`<LengthOfStay MinMaxMessageType="SetMaxLOS"/>`)).restrictions).toEqual([{ ...plan, maxStayArrival: null }]);
    expect(ok(los(`<LengthOfStay MinMaxMessageType="SetForwardMaxStay"/>`)).restrictions).toEqual([{ ...plan, maxStayThrough: null }]);
  });

  it('Time="0" clears the limit', () => {
    expect(ok(los(`<LengthOfStay MinMaxMessageType="SetMinLOS" Time="0"/><LengthOfStay MinMaxMessageType="SetForwardMinStay" Time="0"/>`)).restrictions).toEqual([
      { ...plan, minStayArrival: null, minStayThrough: null },
    ]);
  });

  it("takes the docs' full range 1..9999", () => {
    expect(ok(los(`<LengthOfStay MinMaxMessageType="SetMinLOS" Time="1"/><LengthOfStay MinMaxMessageType="SetForwardMaxStay" Time="9999"/>`)).restrictions).toEqual([
      { ...plan, minStayArrival: 1, maxStayThrough: 9999 },
    ]);
  });

  it("refuses a min stay without Time (the docs say it is always sent)", () => {
    expect(fails(los(`<LengthOfStay MinMaxMessageType="SetMinLOS"/>`))).toEqual({ type: 10, message: "Attribute Time must exist for SetMinLOS" });
    expect(fails(los(`<LengthOfStay MinMaxMessageType="SetForwardMinStay"/>`)).type).toBe(10);
  });

  it("refuses a Time that is not a whole number of nights up to 9999", () => {
    for (const time of ["-1", "1.5", "abc", "", "10000", "1e2"]) {
      expect(fails(los(`<LengthOfStay MinMaxMessageType="SetMinLOS" Time="${time}"/>`)).type).toBe(10);
    }
  });

  it("ignores an unknown MinMaxMessageType and keeps the rest (docs FAQ: never fail the whole message)", () => {
    expect(ok(los(`<LengthOfStay MinMaxMessageType="SetMinStay" Time="2"/><LengthOfStay MinMaxMessageType="SetMinLOS" Time="3"/>`)).restrictions).toEqual([
      { ...plan, minStayArrival: 3 },
    ]);
    expect(ok(los(`<LengthOfStay MinMaxMessageType="SetMinStay" Time="2"/>`)).restrictions).toEqual([]);
  });
});

describe("dates", () => {
  it("keeps Start/End as the inclusive from/to", () => {
    expect(ok(avail(msg("", ` BookingLimit="1"`, control("2031-12-30", "2032-01-02")))).inventory).toEqual([
      { roomCode: "RSGL2031", from: "2031-12-30", to: "2032-01-02", unitsLeft: 1 },
    ]);
  });

  it("keeps a range of exactly MAX_ARI_SPAN_DAYS whole", () => {
    // 2031-01-01 + 749 days = 2033-01-19 (2031 has 365 days, 2032 has 366).
    expect(ok(avail(msg("", ` BookingLimit="1"`, control("2031-01-01", "2033-01-19")))).inventory).toEqual([
      { roomCode: "RSGL2031", from: "2031-01-01", to: "2033-01-19", unitsLeft: 1 },
    ]);
  });

  it("splits a longer range into spans the Apps API accepts, across a leap day", () => {
    const { inventory, restrictions } = ok(avail(msg(`<RestrictionStatus Status="Close"/>`, ` BookingLimit="2"`, control("2031-01-01", "2033-01-31"))));
    expect(inventory).toEqual([
      { roomCode: "RSGL2031", from: "2031-01-01", to: "2033-01-19", unitsLeft: 2 },
      { roomCode: "RSGL2031", from: "2033-01-20", to: "2033-01-31", unitsLeft: 2 },
    ]);
    expect(restrictions).toEqual([
      { ratePlanCode: "PBAR2031", from: "2031-01-01", to: "2033-01-19", closed: true },
      { ratePlanCode: "PBAR2031", from: "2033-01-20", to: "2033-01-31", closed: true },
    ]);
  });

  it("refuses a range over twice the 750-day horizon (no single message may expand to years of nights)", () => {
    // 2031-01-01 + 1499 days = 2035-02-08: the longest range taken.
    expect(ok(avail(msg("", ` BookingLimit="1"`, control("2031-01-01", "2035-02-08")))).inventory).toHaveLength(2);
    expect(fails(avail(msg("", ` BookingLimit="1"`, control("2031-01-01", "2035-02-09"))))).toEqual({
      type: 10,
      message: "Start to End spans 1501 days, at most 1500",
    });
  });

  it("refuses End before Start and dates that are not real calendar dates", () => {
    expect(fails(avail(msg("", ` BookingLimit="1"`, control("2031-05-03", "2031-05-01"))))).toEqual({ type: 10, message: "End must not be before Start" });
    for (const [start, end] of [["2031-02-29", "2031-03-01"], ["2031-05-01", "2031-13-01"], ["31-05-01", "2031-05-02"], ["2031-05-01T00:00:00", "2031-05-02"]]) {
      expect(fails(avail(msg("", ` BookingLimit="1"`, control(start, end)))).type).toBe(10);
    }
  });

  it("refuses weekday attributes: SiteMinder's docs define none, so applying the range to every day would be wrong", () => {
    for (const day of ["Mon", "Tue", "Weds", "Thur", "Fri", "Sat", "Sun"]) {
      expect(fails(avail(msg("", ` BookingLimit="1"`, control("2031-05-01", "2031-05-07", ` ${day}="true"`))))).toEqual({
        type: 10,
        message: `Attribute ${day} on StatusApplicationControl is not supported`,
      });
    }
  });
});

describe("BookingLimit", () => {
  it("takes 0 and any positive whole number, capped at what an integer column holds", () => {
    expect(ok(avail(msg("", ` BookingLimit="0"`))).inventory[0]!.unitsLeft).toBe(0);
    expect(ok(avail(msg("", ` BookingLimit="012"`))).inventory[0]!.unitsLeft).toBe(12);
    expect(ok(avail(msg("", ` BookingLimit="99999999999"`))).inventory[0]!.unitsLeft).toBe(2_147_483_647);
  });

  it("refuses anything that is not a whole number of rooms", () => {
    for (const limit of ["-1", "1.5", "abc", "", "1e3", " 3"]) {
      expect(fails(avail(msg("", ` BookingLimit="${limit}"`)))).toEqual({ type: 10, message: `BookingLimit must be a whole number of rooms, got "${limit}"` });
    }
  });

  it("needs InvTypeCode only for availability, RatePlanCode only for restrictions", () => {
    const noRate = `<StatusApplicationControl Start="2031-05-01" End="2031-05-03" InvTypeCode="RSGL2031"/>`;
    const noRoom = `<StatusApplicationControl Start="2031-05-01" End="2031-05-03" RatePlanCode="PBAR2031"/>`;
    expect(ok(avail(msg("", ` BookingLimit="3"`, noRate))).inventory).toEqual([{ roomCode: "RSGL2031", ...dates, unitsLeft: 3 }]);
    expect(ok(avail(msg(`<RestrictionStatus Status="Close"/>`, "", noRoom))).restrictions).toEqual([{ ...plan, closed: true }]);
    expect(fails(avail(msg("", ` BookingLimit="3"`, noRoom)))).toEqual({ type: 10, message: "Attribute InvTypeCode must exist" });
    expect(fails(avail(msg(`<RestrictionStatus Status="Close"/>`, "", noRate)))).toEqual({ type: 10, message: "Attribute RatePlanCode must exist" });
  });
});

describe("malformed messages", () => {
  it("refuses unknown Status values; ignores an unknown Restriction type and keeps the rest of the message", () => {
    expect(fails(avail(msg(`<RestrictionStatus Status="Closed"/>`)))).toEqual({ type: 10, message: 'RestrictionStatus Status must be Open or Close, got "Closed"' });
    expect(fails(avail(msg(`<RestrictionStatus/>`)))).toEqual({ type: 10, message: 'RestrictionStatus Status must be Open or Close, got ""' });
    expect(ok(avail(msg(`<RestrictionStatus Restriction="Master" Status="Close"/>`, ` BookingLimit="4"`)))).toEqual({
      hotelCode: "SM-AV-2031",
      inventory: [{ roomCode: "RSGL2031", ...dates, unitsLeft: 4 }],
      restrictions: [],
    });
  });

  it("refuses a message without HotelCode, AvailStatusMessages, AvailStatusMessage or StatusApplicationControl", () => {
    expect(fails(avail(msg(""), ""))).toEqual({ type: 10, message: "Attribute HotelCode must exist" });
    expect(fails(root(`<OTA_HotelAvailNotifRQ Version="1.0"/>`))).toEqual({ type: 10, message: "Node AvailStatusMessages must occur once" });
    expect(fails(avail(""))).toEqual({ type: 10, message: "Node AvailStatusMessage must exist" });
    expect(fails(avail(`<AvailStatusMessage BookingLimit="1"/>`))).toEqual({ type: 10, message: "Node StatusApplicationControl must occur once" });
    expect(fails(avail(msg("", "", control() + control())))).toEqual({ type: 10, message: "Node StatusApplicationControl must occur once" });
  });

  it("decodes entities in codes (values arrive decoded from the parser)", () => {
    const ctl = `<StatusApplicationControl Start="2031-05-01" End="2031-05-03" InvTypeCode="A&amp;B" RatePlanCode="P&amp;Q"/>`;
    expect(ok(avail(msg(`<RestrictionStatus Status="Close"/>`, ` BookingLimit="1"`, ctl)))).toEqual({
      hotelCode: "SM-AV-2031",
      inventory: [{ roomCode: "A&B", ...dates, unitsLeft: 1 }],
      restrictions: [{ ratePlanCode: "P&Q", ...dates, closed: true }],
    });
  });
});
