// Order matters in both lists: Edge/Opera/Samsung UAs also contain "Chrome",
// Chrome's contains "Safari", iOS UAs contain "Mac OS X", and Android and
// ChromeOS UAs contain "Linux".
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPad\b/, "iPadOS"],
  [/\biPhone\b|\biPod\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMacintosh\b|\bMac OS X\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

function firstMatch(ua: string, list: [RegExp, string][]): string | null {
  return list.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
}

/**
 * Trim a user-agent down to something a hotel owner can recognise, e.g.
 * "Chrome on macOS". Shared by the security page and the new-device email so
 * the two describe a session the same way.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = firstMatch(userAgent, BROWSERS);
  const os = firstMatch(userAgent, SYSTEMS);
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}
