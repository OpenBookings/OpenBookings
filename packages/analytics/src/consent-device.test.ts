import { describe, expect, test } from "bun:test";
import { CONSENT_STORAGE_KEY, loadConsent, saveConsent } from "./consent-device";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const NOW = Date.UTC(2026, 9, 2);
const DAY = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("device consent record", () => {
  test("a new visitor has no decision", async () => {
    expect(await loadConsent(memoryStorage(), "1.1", NOW)).toEqual({ consent: null, cid: null, backfill: false });
  });

  test("a saved decision is read back with its consent id", async () => {
    const storage = memoryStorage();
    await saveConsent(storage, { consent: "accepted", version: "1.1", cid: "cid-1", expiresAt: NOW + 90 * DAY });
    expect(await loadConsent(storage, "1.1", NOW)).toEqual({ consent: "accepted", cid: "cid-1", backfill: false });
  });

  test("a visitor from before the consent log keeps their choice and is backfilled once", async () => {
    const storage = memoryStorage();
    await saveConsent(storage, { consent: "declined", version: "1.1", cid: null, expiresAt: NOW + 10 * DAY });

    const first = await loadConsent(storage, "1.1", NOW);
    expect(first.consent).toBe("declined");
    expect(first.backfill).toBe(true);
    expect(first.cid).toMatch(UUID);

    const second = await loadConsent(storage, "1.1", NOW);
    expect(second).toEqual({ consent: "declined", cid: first.cid, backfill: false });
  });

  test("a new banner version asks again", async () => {
    const storage = memoryStorage();
    await saveConsent(storage, { consent: "accepted", version: "1.1", cid: "cid-1", expiresAt: NOW + 90 * DAY });
    expect((await loadConsent(storage, "1.2", NOW)).consent).toBeNull();
  });

  test("an expired decision asks again", async () => {
    const storage = memoryStorage();
    await saveConsent(storage, { consent: "accepted", version: "1.1", cid: "cid-1", expiresAt: NOW - 1 });
    expect((await loadConsent(storage, "1.1", NOW)).consent).toBeNull();
  });

  test("a hand-edited record is not trusted", async () => {
    const storage = memoryStorage();
    await saveConsent(storage, { consent: "declined", version: "1.1", cid: "cid-1", expiresAt: NOW + 90 * DAY });
    const record = JSON.parse(storage.data[CONSENT_STORAGE_KEY]!);
    storage.data[CONSENT_STORAGE_KEY] = JSON.stringify({ ...record, v: "accepted" });
    expect((await loadConsent(storage, "1.1", NOW)).consent).toBeNull();
  });

  test("storage that throws means no decision, not a crash", async () => {
    const storage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(await loadConsent(storage, "1.1", NOW)).toEqual({ consent: null, cid: null, backfill: false });
    await saveConsent(storage, { consent: "accepted", version: "1.1", cid: "cid-1", expiresAt: NOW + DAY });
  });
});
