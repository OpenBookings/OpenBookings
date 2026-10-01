import { describe, expect, test } from "bun:test";
import { locationFromHeaders } from "./location";

describe("locationFromHeaders", () => {
  test("reads the full set of Cloudflare visitor location headers", () => {
    const headers = new Headers({
      "cf-ipcity": "Amsterdam",
      "cf-region": "North Holland",
      "cf-ipcountry": "nl",
      "cf-timezone": "Europe/Amsterdam",
    });
    expect(locationFromHeaders(headers)).toEqual({
      city: "Amsterdam",
      region: "North Holland",
      countryCode: "NL",
      timezone: "Europe/Amsterdam",
    });
  });

  test("degrades to country-only without the managed transform", () => {
    const headers = new Headers({ "cf-ipcountry": "DE" });
    expect(locationFromHeaders(headers)).toEqual({
      city: null,
      region: null,
      countryCode: "DE",
      timezone: null,
    });
  });

  test("treats XX (unknown country) and missing headers as no location", () => {
    expect(locationFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(locationFromHeaders(new Headers())).toBeNull();
    expect(locationFromHeaders(null)).toBeNull();
  });

  test("keeps the Tor marker so the email can call it out", () => {
    const headers = new Headers({ "cf-ipcountry": "T1" });
    expect(locationFromHeaders(headers)?.countryCode).toBe("T1");
  });
});
