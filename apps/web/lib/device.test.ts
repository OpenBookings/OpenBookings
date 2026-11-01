import { describe, expect, test } from "bun:test";
import { describeDevice } from "./device";

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  firefoxLinux:
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIpad:
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  operaWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0",
};

describe("describeDevice", () => {
  test.each([
    [UA.chromeMac, "Chrome on macOS"],
    [UA.safariMac, "Safari on macOS"],
    [UA.edgeWindows, "Edge on Windows"],
    [UA.firefoxLinux, "Firefox on Linux"],
    [UA.safariIphone, "Safari on iOS"],
    [UA.chromeIpad, "Chrome on iPadOS"],
    [UA.samsungAndroid, "Samsung Internet on Android"],
    [UA.chromeOs, "Chrome on ChromeOS"],
    [UA.operaWindows, "Opera on Windows"],
  ])("%s", (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });

  test("falls back when nothing is recognisable", () => {
    expect(describeDevice(null)).toBe("Unknown device");
    expect(describeDevice("")).toBe("Unknown device");
    expect(describeDevice("curl/8.7.1")).toBe("Unknown device");
  });
});
