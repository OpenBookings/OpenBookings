/**
 * The visitor's consent decision as held on their own device.
 *
 * This record, not the server log, decides whether analytics runs: it is
 * readable before any network call, and a visitor who clears their storage
 * has genuinely withdrawn the only thing that was gating them.
 */

export type ConsentState = "accepted" | "declined" | null;

type DeviceStorage = Pick<Storage, "getItem" | "setItem">;

interface ConsentRecord {
  v: ConsentState;
  exp: number;
  h: string;
  ver: string;
  /** Consent id: ties this device's record to its rows in consent_log. */
  cid?: string;
}

export const CONSENT_STORAGE_KEY = "ob_cookie_consent";
export const CONSENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Client-side salt — deters naive localStorage edits, not a secret
const SALT = "ob-consent-v1";

async function hashRecord(v: ConsentState, exp: number): Promise<string> {
  const data = new TextEncoder().encode(`${v}:${exp}:${SALT}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function saveConsent(
  storage: DeviceStorage,
  input: { consent: Exclude<ConsentState, null>; version: string; cid: string | null; expiresAt: number },
): Promise<void> {
  try {
    const h = await hashRecord(input.consent, input.expiresAt);
    const record: ConsentRecord = {
      v: input.consent,
      exp: input.expiresAt,
      h,
      ver: input.version,
      ...(input.cid ? { cid: input.cid } : {}),
    };
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage refused (private window, blocked site data). The choice still
    // holds for this page view; it just will not be remembered.
  }
}

/**
 * Reads the decision. `backfill` is true exactly once for a record written
 * before the consent log existed: it is given a consent id here, and the
 * caller owes the server one event describing the choice already made.
 */
export async function loadConsent(
  storage: DeviceStorage,
  version: string,
  now: number = Date.now(),
): Promise<{ consent: ConsentState; cid: string | null; backfill: boolean }> {
  const none = { consent: null, cid: null, backfill: false } as const;
  try {
    const raw = storage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return none;
    const record: ConsentRecord = JSON.parse(raw);
    if (record.ver !== version) return none;
    if (record.v !== "accepted" && record.v !== "declined") return none;
    if (typeof record.exp !== "number" || now > record.exp) return none;
    if ((await hashRecord(record.v, record.exp)) !== record.h) return none;

    if (typeof record.cid === "string" && record.cid) {
      return { consent: record.v, cid: record.cid, backfill: false };
    }

    const cid = newConsentUuid();
    await saveConsent(storage, { consent: record.v, version, cid, expiresAt: record.exp });
    return { consent: record.v, cid, backfill: true };
  } catch {
    return none;
  }
}

/**
 * Take the server's expiry for a decision, so device and log agree on when it
 * lapses — but only if the stored record is still that decision. Another tab
 * may have changed the choice since; its record is not ours to overwrite.
 */
export async function adoptExpiry(
  storage: DeviceStorage,
  input: { consent: Exclude<ConsentState, null>; cid: string; expiresAt: number },
): Promise<void> {
  try {
    const raw = storage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return;
    const record: ConsentRecord = JSON.parse(raw);
    if (record.cid !== input.cid || record.v !== input.consent) return;
    if (!Number.isFinite(input.expiresAt)) return;
    await saveConsent(storage, {
      consent: input.consent,
      version: record.ver,
      cid: input.cid,
      expiresAt: input.expiresAt,
    });
  } catch {
    // Keep the expiry the device already has.
  }
}

/**
 * A random UUID. `crypto.randomUUID` is missing in older Safari and on pages
 * served from a non-secure origin; the banner must still be dismissable there.
 */
export function newConsentUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
