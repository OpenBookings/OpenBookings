import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RateChangeSchema } from "@openbookings/apps-contract";
import { invalidIncludedOccupancy } from "../soap/errors";
import { xmlParser } from "../soap/xml";
import { decimalToCents, rateAmountNotifToChanges } from "./rate-amount-notif";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "../../fixtures", name), "utf8");
const root = (xml: string) => (xmlParser.parse(xml) as Record<string, Record<string, unknown>>).OTA_HotelRateAmountNotifRQ!;

const control = (start = "2031-06-01", end = "2031-06-07", rate = ` RatePlanCode="PBAR2031"`) =>
  `<StatusApplicationControl Start="${start}" End="${end}" InvTypeCode="RSGL2031"${rate}/>`;
const message = (rateInner: string, ctl = control()) =>
  `<RateAmountMessage>${ctl}<Rates><Rate>${rateInner}</Rate></Rates></RateAmountMessage>`;
const rates = (messages: string, hotel = ` HotelCode="SM-RA-2031"`) =>
  root(`<OTA_HotelRateAmountNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05" Version="1.0"><RateAmountMessages${hotel}>${messages}</RateAmountMessages></OTA_HotelRateAmountNotifRQ>`);
const base = (attrs = `AmountAfterTax="186.50" CurrencyCode="EUR"`) => `<BaseByGuestAmts><BaseByGuestAmt AgeQualifyingCode="10" ${attrs}/></BaseByGuestAmts>`;
const extras = (inner: string) => `<AdditionalGuestAmounts>${inner}</AdditionalGuestAmounts>`;
const change = { ratePlanCode: "PBAR2031", from: "2031-06-01", to: "2031-06-07" };

function ok(body: Record<string, unknown>) {
  const result = rateAmountNotifToChanges(body);
  if ("error" in result) throw new Error(`unexpected error: ${result.error.message}`);
  for (const c of result.rates) RateChangeSchema.parse(c);
  return result;
}
function fails(body: Record<string, unknown>) {
  const result = rateAmountNotifToChanges(body);
  if (!("error" in result)) throw new Error(`expected an error, got ${JSON.stringify(result)}`);
  return result.error;
}

describe("decimalToCents", () => {
  it("turns decimal strings into integer cents exactly", () => {
    const cases: [string, number][] = [
      ["186.50", 18650],
      ["0.1", 10],
      ["186.5", 18650],
      ["300.00", 30000],
      ["100", 10000],
      ["0", 0],
      ["0.01", 1],
      ["007.05", 705],
      ["0.29", 29], // 0.29 * 100 is 28.999999999999996 in floating point
      ["1.15", 115], // 1.15 * 100 is 114.99999999999999
      ["90071992547409.91", 9007199254740991],
    ];
    for (const [input, cents] of cases) expect([input, decimalToCents(input)]).toEqual([input, cents]);
  });

  it("takes trailing zeros past two decimals (lossless) but never rounds a third decimal", () => {
    expect(decimalToCents("186.500")).toBe(18650);
    expect(decimalToCents("186.5000")).toBe(18650);
    expect(decimalToCents("186.501")).toBeUndefined();
    expect(decimalToCents("1.005")).toBeUndefined();
    expect(decimalToCents("0.999")).toBeUndefined();
  });

  it("refuses exponents, signs, separators and anything else that is not a plain decimal", () => {
    for (const input of ["1e3", "1E3", "1.5e2", "-1", "-0.50", "+1", ".5", "5.", "", " 1", "1 ", "1,00", "1.000,00", "NaN", "Infinity", "0x10", "١٢", "90071992547409.92"]) {
      expect([input, decimalToCents(input)]).toEqual([input, undefined]);
    }
  });
});

describe("rateAmountNotifToChanges on SiteMinder's PDP samples", () => {
  const day = { ratePlanCode: "BAR", from: "2025-10-05", to: "2025-10-05" };

  it("maps the Base Rates sample", () => {
    expect(ok(root(fixture("rates-rq-pdp-base.xml")))).toEqual({
      hotelCode: "HOTELCODE",
      rates: [{ ...day, priceCents: 30000, extraAdultCents: null, extraChildCents: null }],
    });
  });

  it("maps the With Additional Guest Amounts sample: extra adult (10) and extra child (8)", () => {
    expect(ok(root(fixture("rates-rq-pdp-additional-guest-amounts.xml")))).toEqual({
      hotelCode: "HOTELCODE",
      rates: [{ ...day, priceCents: 30000, extraAdultCents: 10000, extraChildCents: 5000 }],
    });
  });

  it("takes the base rate from the Single Guest Discount sample and ignores the discount (feature not offered)", () => {
    expect(ok(root(fixture("rates-rq-pdp-single-guest-discount.xml")))).toEqual({
      hotelCode: "HOTELCODE",
      rates: [{ ...day, priceCents: 30000, extraAdultCents: null, extraChildCents: null }],
    });
  });

  it("answers Invalid included occupancy (Type 12, Code 137) to the samples that set an Included Occupancy", () => {
    for (const file of ["rates-rq-pdp-included-occupancy.xml", "rates-rq-pdp-included-occupancy-and-single-guest-discount.xml", "rates-rq-pdp-all-four-rate-fields.xml"]) {
      expect([file, fails(root(fixture(file)))]).toEqual([file, { type: 12, code: 137, message: "Invalid included occupancy" }]);
    }
  });

  it("answers Invalid included occupancy to occupancy-based (OBP) samples, which we do not take", () => {
    for (const file of ["rates-rq-obp-rates.xml", "rates-rq-obp-undefined-settings.xml"]) {
      expect([file, fails(root(fixture(file)))]).toEqual([file, invalidIncludedOccupancy()]);
    }
  });
});

describe("rateAmountNotifToChanges", () => {
  it('maps "186.50" to 18650 cents and "0.1" to 10', () => {
    expect(ok(rates(message(base())))).toEqual({ hotelCode: "SM-RA-2031", rates: [{ ...change, priceCents: 18650, extraAdultCents: null, extraChildCents: null }] });
    expect(ok(rates(message(base(`AmountAfterTax="0.1"`)))).rates[0]!.priceCents).toBe(10);
  });

  it("refuses an exponent, a negative or a third decimal in AmountAfterTax", () => {
    for (const amount of ["1e3", "-186.50", "186.505"]) {
      expect(fails(rates(message(base(`AmountAfterTax="${amount}" CurrencyCode="EUR"`))))).toEqual({
        type: 10,
        message: `AmountAfterTax must be a decimal amount like 186.50, got "${amount}"`,
      });
    }
  });

  it("refuses a zero room price: the docs define AmountAfterTax as positive", () => {
    expect(fails(rates(message(base(`AmountAfterTax="0.00"`))))).toEqual({ type: 10, message: "AmountAfterTax must be greater than 0" });
  });

  it("asks the hotel for tax-inclusive rates when AmountAfterTax is missing", () => {
    expect(fails(rates(message(base(`AmountBeforeTax="150.00" CurrencyCode="EUR"`))))).toEqual({
      type: 12,
      message: "Rates must include tax: send AmountAfterTax (tax-inclusive rates)",
    });
  });

  it("refuses any currency but EUR, on the base and on extra guest amounts; no CurrencyCode means EUR", () => {
    const usd = { type: 12, message: "Currency USD is not supported: send rates in EUR" };
    expect(fails(rates(message(base(`AmountAfterTax="100.00" CurrencyCode="USD"`))))).toEqual(usd);
    expect(fails(rates(message(base() + extras(`<AdditionalGuestAmount AgeQualifyingCode="8" Amount="10" CurrencyCode="USD"/>`))))).toEqual(usd);
    expect(fails(rates(message(base(`AmountAfterTax="100.00" CurrencyCode="eur"`)))).type).toBe(12);
    expect(ok(rates(message(base(`AmountAfterTax="100.00"`) + extras(`<AdditionalGuestAmount AgeQualifyingCode="10" Amount="25.5"/>`)))).rates).toEqual([
      { ...change, priceCents: 10000, extraAdultCents: 2550, extraChildCents: null },
    ]);
  });

  it("maps extra adult and child amounts, a zero extra is a free extra guest, absent is null", () => {
    expect(ok(rates(message(base() + extras(`<AdditionalGuestAmount AgeQualifyingCode="8" Amount="0" CurrencyCode="EUR"/>`)))).rates).toEqual([
      { ...change, priceCents: 18650, extraAdultCents: null, extraChildCents: 0 },
    ]);
  });

  it("refuses unknown, repeated or malformed extra guest amounts", () => {
    const one = (attrs: string) => fails(rates(message(base() + extras(`<AdditionalGuestAmount ${attrs}/>`))));
    expect(one(`AgeQualifyingCode="7" Amount="10"`)).toEqual({ type: 10, message: 'Unsupported AdditionalGuestAmount AgeQualifyingCode "7"' });
    expect(one(`Amount="10"`)).toEqual({ type: 10, message: 'Unsupported AdditionalGuestAmount AgeQualifyingCode ""' });
    expect(one(`AgeQualifyingCode="10"`)).toEqual({ type: 10, message: 'Amount must be a decimal amount like 186.50, got ""' });
    expect(one(`AgeQualifyingCode="10" Amount="1e1"`)).toEqual({ type: 10, message: 'Amount must be a decimal amount like 186.50, got "1e1"' });
    expect(fails(rates(message(base() + extras(`<AdditionalGuestAmount AgeQualifyingCode="8" Amount="10"/><AdditionalGuestAmount AgeQualifyingCode="8" Amount="20"/>`))))).toEqual({
      type: 10,
      message: 'AdditionalGuestAmount AgeQualifyingCode "8" must occur once',
    });
  });

  it("refuses a rate without a base amount, or with two", () => {
    expect(fails(rates(message("")))).toEqual({ type: 10, message: "Node BaseByGuestAmt must exist" });
    const two = `<BaseByGuestAmts><BaseByGuestAmt AmountAfterTax="100.00"/><BaseByGuestAmt AmountAfterTax="120.00"/></BaseByGuestAmts>`;
    expect(fails(rates(message(two)))).toEqual({ type: 10, message: "Node BaseByGuestAmt without NumberOfGuests must occur once" });
  });

  it("answers Invalid included occupancy for a lone NumberOfGuests amount and refuses a malformed NumberOfGuests", () => {
    expect(fails(rates(message(base(`AmountAfterTax="100.00" NumberOfGuests="2"`))))).toEqual(invalidIncludedOccupancy());
    expect(fails(rates(message(base(`AmountAfterTax="100.00" NumberOfGuests="1"`))))).toEqual(invalidIncludedOccupancy());
    expect(fails(rates(message(base(`AmountAfterTax="100.00" NumberOfGuests="two"`))))).toEqual({ type: 10, message: 'NumberOfGuests must be a whole number, got "two"' });
  });

  it("maps several messages in order and splits a range longer than the Apps API takes", () => {
    const body = rates(
      message(base(`AmountAfterTax="99.99"`), control("2031-01-01", "2033-01-31")) +
        message(base(`AmountAfterTax="120"`), control("2031-06-01", "2031-06-01", ` RatePlanCode="PNR2031"`)),
    );
    const amounts = { extraAdultCents: null, extraChildCents: null };
    expect(ok(body).rates).toEqual([
      { ratePlanCode: "PBAR2031", from: "2031-01-01", to: "2033-01-19", priceCents: 9999, ...amounts },
      { ratePlanCode: "PBAR2031", from: "2033-01-20", to: "2033-01-31", priceCents: 9999, ...amounts },
      { ratePlanCode: "PNR2031", from: "2031-06-01", to: "2031-06-01", priceCents: 12000, ...amounts },
    ]);
  });

  it("refuses malformed structure: no HotelCode, RatePlanCode, Rate, or bad dates", () => {
    expect(fails(rates(message(base()), ""))).toEqual({ type: 10, message: "Attribute HotelCode must exist" });
    expect(fails(root(`<OTA_HotelRateAmountNotifRQ Version="1.0"/>`))).toEqual({ type: 10, message: "Node RateAmountMessages must occur once" });
    expect(fails(rates(""))).toEqual({ type: 10, message: "Node RateAmountMessage must exist" });
    expect(fails(rates(message(base(), control("2031-06-01", "2031-06-07", ""))))).toEqual({ type: 10, message: "Attribute RatePlanCode must exist" });
    expect(fails(rates(`<RateAmountMessage>${control()}</RateAmountMessage>`))).toEqual({ type: 10, message: "Node Rate must occur once" });
    expect(fails(rates(`<RateAmountMessage>${control()}<Rates><Rate>${base()}</Rate><Rate>${base()}</Rate></Rates></RateAmountMessage>`))).toEqual({
      type: 10,
      message: "Node Rate must occur once",
    });
    expect(fails(rates(message(base(), control("2031-06-07", "2031-06-01"))))).toEqual({ type: 10, message: "End must not be before Start" });
    expect(fails(rates(message(base(), control("2031-06-01", "2031-06-07", ` RatePlanCode="PBAR2031" Sat="false"`))))).toEqual({
      type: 10,
      message: "Attribute Sat on StatusApplicationControl is not supported",
    });
  });
});
