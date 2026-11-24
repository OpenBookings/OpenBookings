import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { XMLValidator } from "fast-xml-parser";
import { MAX_BODY_BYTES, buildResponse, parseEnvelope, xmlEscape } from "./envelope";
import { xmlParser } from "./xml";
import { hotelNotFound, invalidIncludedOccupancy, invalidNumberOfAdults, rateCodeNotFound, roomTypeNotFound } from "./errors";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "../../fixtures", name), "utf8");
const securityFixture = fixture("security-header-envelope.xml");
const fromFixture = (xml: string, pattern: RegExp) => pattern.exec(xml)?.[1] ?? "";
// The docs' sample username and password, read from the fixture rather than repeated here.
const creds = {
  username: fromFixture(securityFixture, /<wsse:Username>([^<]+)</),
  password: fromFixture(securityFixture, /<wsse:Password [^>]*>([^<]+)</),
};
const echoToken = fromFixture(fixture("rooms-and-rates-rq.xml"), /EchoToken="([^"]+)"/);

// The docs' security header shape, with real credentials, around a verbatim sample body.
const header = (c = creds) =>
  /<SOAP-ENV:Header>[\s\S]*<\/SOAP-ENV:Header>/
    .exec(securityFixture)?.[0]
    .replace(`>${creds.username}<`, `>${c.username}<`)
    .replace(`>${creds.password}<`, `>${c.password}<`) ?? "";
const wrap = (body: string, c = creds) =>
  `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">${header(c)}<SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const requests = [
  ["rooms-and-rates-rq.xml", "HotelAvailRQ"],
  ["availability-rq-stay-on-arrival.xml", "HotelAvailNotifRQ"],
  ["availability-rq-stay-through.xml", "HotelAvailNotifRQ"],
  ["rates-rq-pdp-base.xml", "HotelRateAmountNotifRQ"],
  ["rates-rq-pdp-included-occupancy.xml", "HotelRateAmountNotifRQ"],
  ["rates-rq-pdp-single-guest-discount.xml", "HotelRateAmountNotifRQ"],
  ["rates-rq-pdp-included-occupancy-and-single-guest-discount.xml", "HotelRateAmountNotifRQ"],
  ["rates-rq-pdp-additional-guest-amounts.xml", "HotelRateAmountNotifRQ"],
  ["rates-rq-pdp-all-four-rate-fields.xml", "HotelRateAmountNotifRQ"],
  ["rates-rq-obp-rates.xml", "HotelRateAmountNotifRQ"],
  ["rates-rq-obp-undefined-settings.xml", "HotelRateAmountNotifRQ"],
] as const;

describe("parseEnvelope", () => {
  it.each(requests)("parses %s as %s with its EchoToken", (file, kind) => {
    const result = parseEnvelope(wrap(fixture(file)), creds);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.kind).toBe(kind);
    expect(result.request.echoToken).toBe(echoToken);
    expect(result.request.timeStamp).toMatch(/^202\d-07-06T15:27:41\+00:00$/);
  });

  it("parses the docs' own security-header envelope verbatim", () => {
    const result = parseEnvelope(securityFixture, creds);
    expect(result.ok).toBe(true);
  });

  it("exposes the message content, keeping decimals as strings", () => {
    const result = parseEnvelope(wrap(fixture("rates-rq-pdp-base.xml")), creds);
    if (!result.ok) throw new Error("expected ok");
    const messages = result.request.body.RateAmountMessages as Record<string, any>;
    expect(messages["@_HotelCode"]).toBe("HOTELCODE");
    const amt = messages.RateAmountMessage.Rates.Rate.BaseByGuestAmts.BaseByGuestAmt;
    expect(amt["@_AmountAfterTax"]).toBe("300.00");
    expect(amt["@_CurrencyCode"]).toBe("EUR");
    expect(messages.RateAmountMessage.StatusApplicationControl["@_Start"]).toBe("2025-10-05");
  });

  it("parses LOS, CTA, CTD and stop sell restrictions", () => {
    const result = parseEnvelope(wrap(fixture("availability-rq-stay-on-arrival.xml")), creds);
    if (!result.ok) throw new Error("expected ok");
    const msgs = (result.request.body.AvailStatusMessages as Record<string, any>).AvailStatusMessage as Record<string, any>[];
    expect(msgs).toHaveLength(4);
    expect(msgs[0]["@_BookingLimit"]).toBe("10");
    expect(msgs[1].LengthsOfStay.LengthOfStay.map((l: any) => l["@_MinMaxMessageType"])).toEqual(["SetMinLOS", "SetMaxLOS"]);
    expect(msgs[2].RestrictionStatus["@_Restriction"]).toBe("Arrival");
    expect(msgs[3].RestrictionStatus["@_Restriction"]).toBe("Departure");
  });

  describe("credentials", () => {
    const body = fixture("rooms-and-rates-rq.xml");

    it("answers a wrong password with 448 / type 4 and enough context to reply", () => {
      const result = parseEnvelope(wrap(body, { ...creds, password: `${creds.password}x` }), creds);
      expect(result).toEqual({
        ok: false,
        fault: { type: 4, code: 448, message: "Invalid Username and/or Password" },
        kind: "HotelAvailRQ",
        echoToken,
      });
    });

    it("rejects a wrong username, a missing header and a missing token", () => {
      for (const xml of [
        wrap(body, { ...creds, username: "other" }),
        `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`,
        `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header/><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`,
      ]) {
        const result = parseEnvelope(xml, creds);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.fault.code).toBe(448);
      }
    });

    it("rejects a password type other than PasswordText", () => {
      const digest = wrap(body).replace("#PasswordText", "#PasswordDigest");
      const result = parseEnvelope(digest, creds);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fault.code).toBe(448);
    });

    it("rejects passwords that are a prefix or an extension of the real one", () => {
      expect(parseEnvelope(wrap(body, { ...creds, password: `${creds.password}x` }), creds).ok).toBe(false);
      expect(parseEnvelope(wrap(body, { ...creds, password: creds.password.slice(1) }), creds).ok).toBe(false);
    });
  });

  describe("hostile input", () => {
    const body = fixture("rooms-and-rates-rq.xml");

    it("refuses a billion-laughs body without parsing it", () => {
      const lols = Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "${i === 0 ? "lol" : `&lol${i};`.repeat(10)}">`).join("");
      const xml = `<?xml version="1.0"?><!DOCTYPE lolz [${lols}]><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><a>&lol9;</a></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
      const started = performance.now();
      const result = parseEnvelope(xml, creds);
      expect(performance.now() - started).toBeLessThan(50);
      expect(result.ok).toBe(false);
    });

    it.each([
      ["DOCTYPE", `<!DOCTYPE foo>${wrap(body)}`],
      ["lower case doctype", `<!doctype foo>${wrap(body)}`],
      ["spaced doctype", `<!   DOCTYPE foo>${wrap(body)}`],
      ["ENTITY", `<!ENTITY x "y">${wrap(body)}`],
      ["internal subset", `<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]>${wrap(body)}`],
    ])("refuses %s", (_name, xml) => {
      const result = parseEnvelope(xml, creds);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fault.message).toContain("DOCTYPE");
    });

    it("refuses a body over MAX_BODY_BYTES", () => {
      const result = parseEnvelope(wrap(body) + " ".repeat(MAX_BODY_BYTES), creds);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fault.message).toBe("Request body too large");
    });

    it("counts bytes, not characters", () => {
      const xml = `<!-- ${"é".repeat(MAX_BODY_BYTES / 2)} -->${wrap(body)}`;
      expect(xml.length).toBeLessThan(MAX_BODY_BYTES);
      expect(parseEnvelope(xml, creds).ok).toBe(false);
    });

    it("does not expand predefined entity text", () => {
      const result = parseEnvelope(wrap(body.replace("HOTELCODE", "A&amp;B")), creds);
      if (!result.ok) throw new Error("expected ok");
      const hotel = JSON.stringify(result.request.body);
      expect(hotel).toContain("A&amp;B");
    });

    it.each([
      ["malformed XML", "<a><b></a>"],
      ["not XML at all", "hello"],
      ["no Body", `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"/>`],
      ["an unsupported message", wrap(`<OTA_PingRQ xmlns="http://www.opentravel.org/OTA/2003/05" EchoToken="x" TimeStamp="y" Version="1.0"/>`)],
    ])("faults on %s", (_name, xml) => {
      const result = parseEnvelope(xml, creds);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fault.type).toBe(10);
    });
  });
});

describe("buildResponse", () => {
  const now = new Date("2024-07-06T15:27:41.123Z");
  const echo = echoToken;

  it("builds a minified success with namespace, version, echoed token and empty header", () => {
    const xml = buildResponse("HotelAvailNotifRQ", echo, { success: true }, now);
    expect(xml).toBe(
      `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header/><SOAP-ENV:Body><OTA_HotelAvailNotifRS xmlns="http://www.opentravel.org/OTA/2003/05" EchoToken="${echo}" TimeStamp="2024-07-06T15:27:41Z" Version="1.0"><Success/></OTA_HotelAvailNotifRS></SOAP-ENV:Body></SOAP-ENV:Envelope>`,
    );
    expect(xml).not.toMatch(/[\n\t]|>\s+</);
  });

  it("names the RS root from the request kind", () => {
    expect(buildResponse("HotelAvailRQ", echo, { success: true }, now)).toContain("<OTA_HotelAvailRS ");
    expect(buildResponse("HotelRateAmountNotifRQ", echo, { success: true }, now)).toContain("<OTA_HotelRateAmountNotifRS ");
  });

  it("matches the docs' error response, with exact Type, Code and text", () => {
    const xml = buildResponse("HotelRateAmountNotifRQ", echo, { success: false, errors: [hotelNotFound("XXXXXX")] }, now);
    expect(xml).toContain(`<Errors><Error Type="6" Code="392">Hotel not found for HotelCode=XXXXXX</Error></Errors>`);
    expect(xml).not.toContain("<Success");
  });

  it("carries every mandatory error exactly as documented", () => {
    const errors = [roomTypeNotFound(), rateCodeNotFound(), invalidIncludedOccupancy(), invalidNumberOfAdults(), invalidIncludedOccupancy(2), invalidNumberOfAdults(5)];
    const xml = buildResponse("HotelAvailNotifRQ", echo, { success: false, errors }, now);
    expect(xml).toContain('<Error Type="12" Code="402">Room type code not found for this hotel</Error>');
    expect(xml).toContain('<Error Type="12" Code="249">Rate code not found for this hotel</Error>');
    expect(xml).toContain('<Error Type="12" Code="137">Invalid included occupancy</Error>');
    expect(xml).toContain('<Error Type="12" Code="397">Invalid number of adults</Error>');
    expect(xml).toContain('<Error Type="12" Code="137">Invalid included occupancy: expecting 2</Error>');
    expect(xml).toContain('<Error Type="12" Code="397">Invalid number of adults: expecting 5</Error>');
  });

  it("omits Code when an error has none, and escapes the message", () => {
    const xml = buildResponse("HotelAvailRQ", echo, { success: false, errors: [{ type: 10, message: "Node <x> & 'y'" }] }, now);
    expect(xml).toContain(`<Error Type="10">Node &lt;x&gt; &amp; &apos;y&apos;</Error>`);
  });

  it("serialises a payload after Success, escaping text and attributes", () => {
    const xml = buildResponse(
      "HotelAvailRQ",
      echo,
      { success: true, payload: { RoomStays: { RoomStay: [{ RoomType: { "@_RoomTypeCode": "A&B", Text: "O'Brien & Zoë <x>" } }, { RoomType: { "@_RoomTypeCode": "C" } }] } } },
      now,
    );
    expect(xml).toContain(
      `<Success/><RoomStays><RoomStay><RoomType RoomTypeCode="A&amp;B"><Text>O&apos;Brien &amp; Zoë &lt;x&gt;</Text></RoomType></RoomStay><RoomStay><RoomType RoomTypeCode="C"/></RoomStay></RoomStays>`,
    );
  });

  it("echoes a hostile EchoToken as valid XML", () => {
    const xml = buildResponse("HotelAvailRQ", `"><evil/>`, { success: true }, now);
    expect(xml).toContain(`EchoToken="&quot;&gt;&lt;evil/&gt;"`);
  });

  it("produces well-formed XML that parses back to the same errors", () => {
    const xml = buildResponse("HotelAvailRQ", echo, { success: false, errors: [hotelNotFound("A&B <1>")] }, now);
    expect(XMLValidator.validate(xml)).toBe(true);
    const parsed = xmlParser.parse(xml);
    expect(parsed.Envelope.Body.OTA_HotelAvailRS.Errors.Error["#text"]).toBe("Hotel not found for HotelCode=A&amp;B &lt;1&gt;");
  });
});

describe("xmlEscape", () => {
  it("escapes the five predefined entities", () => {
    expect(xmlEscape("O'Brien & Zoë <x>")).toBe("O&apos;Brien &amp; Zoë &lt;x&gt;");
    expect(xmlEscape(`a"b`)).toBe("a&quot;b");
  });

  it("leaves non-Latin text alone and drops characters XML cannot carry", () => {
    expect(xmlEscape("Ἀλέξανδρος")).toBe("Ἀλέξανδρος");
    expect(xmlEscape("a\u0000b\u0008c")).toBe("abc");
  });
});
