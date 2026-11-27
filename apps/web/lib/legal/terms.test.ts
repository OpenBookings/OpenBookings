import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REVIEW_OPENS_AFTER_MS, REVIEW_WINDOW_DAYS } from "@openbookings/pricing";
import { getCurrentVersion, getDocument, getVersion, LEGAL_LOCALES } from "./documents";

const CURRENT = "2026-11-20";
const DIR = join(import.meta.dir, "../../content/legal/terms");
const readVersion = (version: string, locale: string) =>
  readFileSync(join(DIR, version, `${locale}.mdx`), "utf8");
const read = (locale: string) => readVersion(CURRENT, locale);
const clause = (source: string, number: string) =>
  source.split("\n").find((l) => l.startsWith(`**${number}`))!;
const sectionIds = (source: string) =>
  [...source.matchAll(/<Section id="([^"]+)"/g)].map((m) => m[1]);

describe("terms of service registry", () => {
  const doc = getDocument("terms")!;

  test("is registered with the newest version current", () => {
    expect(doc).toBeDefined();
    expect(getCurrentVersion(doc).version).toBe(CURRENT);
  });

  test("the superseded version stays registered for its archive URL", () => {
    expect(getVersion(doc, "2026-11-16")).toBeDefined();
    expect(readVersion("2026-11-16", "en")).toContain("unless the rate says otherwise");
  });

  test("only English is marked translated", () => {
    const { locales } = getCurrentVersion(doc);
    expect(locales.en?.status).toBe("translated");
    expect(locales.nl?.status).toBe("draft");
    expect(locales.fr?.status).toBe("draft");
  });
});

describe("current terms of service content", () => {
  const englishIds = sectionIds(read("en"));

  test("has all 17 numbered sections", () => {
    expect(englishIds).toHaveLength(17);
  });

  for (const locale of LEGAL_LOCALES) {
    const source = read(locale);

    test(`${locale}: keeps the same section ids as English`, () => {
      expect(sectionIds(source)).toEqual(englishIds);
    });

    test(`${locale}: every in-page link points at a real section`, () => {
      const anchors = [...source.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
      expect(anchors.length).toBeGreaterThan(0);
      for (const anchor of anchors) expect(englishIds).toContain(anchor);
    });

    test(`${locale}: links to the privacy policy in the same language`, () => {
      const privacyLinks = [...source.matchAll(/\]\((\/legal\/[^)]+)\)/g)].map((m) => m[1]);
      expect(privacyLinks.length).toBeGreaterThan(0);
      for (const href of privacyLinks) expect(href).toBe(`/legal/${locale}/privacy`);
    });

    test(`${locale}: names the AGPL, not the MPL`, () => {
      expect(source).toContain("AGPL-3.0-only");
      expect(source).not.toMatch(/Mozilla/);
    });

    test(`${locale}: describes reviews instead of saying they aren't available`, () => {
      expect(source).toMatch(/\*\*10\.7 (Reviews|Beoordelingen|Avis)\.\*\*/);
      expect(source).toMatch(/30 (days|dagen|jours)/);
    });

    test(`${locale}: states when a review opens and closes, as the review rules do`, () => {
      const reviews = clause(source, "10.7");
      expect(reviews).toMatch(new RegExp(`\\b${REVIEW_OPENS_AFTER_MS / 3_600_000} (hours|uur|heures) (after|na|après)`));
      expect(reviews).toMatch(new RegExp(`\\b${REVIEW_WINDOW_DAYS} (days|dagen|jours) (after|na|après)`));
    });

    test(`${locale}: does not promise account deletion "at any time"`, () => {
      // apps/web/lib/account/deletion.ts blocks deletion during an upcoming stay.
      const clause = source.split("\n").find((l) => l.startsWith("**3.5**"))!;
      expect(clause).not.toMatch(/at any time|op elk moment|à tout moment/);
    });

    test(`${locale}: tourist tax is always added on top and paid when you book`, () => {
      // No property collects tourist tax at the property; it is always on the booking.
      expect(clause(source, "6.2")).not.toMatch(/at the property|ter plaatse|sur place/);
      expect(clause(source, "6.4")).not.toMatch(/unless|tenzij|sauf/);
    });

    test(`${locale}: cots and extra beds are paid at the property and shown up front`, () => {
      expect(clause(source, "6.3")).toMatch(/cot|babybed|lits? bébé/i);
      expect(source).toMatch(/any amount you pay at the property|elk bedrag dat u bij de accommodatie betaalt|tout montant que vous payez sur place/);
    });

    test(`${locale}: support is by email, with no chat or opening hours promised`, () => {
      expect(source).not.toMatch(/chat/i);
      expect(source).not.toContain("[HOURS]");
      expect(clause(source, "11.1")).toContain("support@openbookings.co");
    });

    test(`${locale}: a cancellation through support counts from when it is processed`, () => {
      expect(clause(source, "8.2")).toContain("support@openbookings.co");
      expect(clause(source, "8.2")).toMatch(/when we process it|wij die verwerken|nous la traitons/);
    });

    test(`${locale}: a no-show pays the full price on every rate, tourist tax included`, () => {
      const noShow = clause(source, "8.4");
      expect(noShow).not.toMatch(/most rates|meeste tarieven|plupart des tarifs/);
      expect(noShow).toMatch(/every rate|elk tarief|tous les tarifs/);
      expect(noShow).toMatch(/tourist tax|toeristenbelasting|taxe de séjour/);
    });

    test(`${locale}: does not promise a refund-issued email`, () => {
      expect(clause(source, "8.5")).not.toMatch(/once a refund has been issued|zodra een terugbetaling is gedaan|l'émission d'un remboursement/);
      expect(clause(source, "8.5")).toMatch(/5 (to|tot|à) 10/);
    });

    test(`${locale}: travel bans get a full refund on any rate, as in Host Agreement B.5.6`, () => {
      const exceptional = clause(source, "8.7");
      expect(exceptional).toMatch(/any rate|elk tarief|quel que soit le tarif/);
      expect(exceptional).not.toMatch(/illness or a travel ban|ziekte of een reisverbod|maladie ou une interdiction/);
    });

    test(`${locale}: carries no internal drafting notes`, () => {
      expect(source).not.toContain("🔧");
      expect(source).not.toMatch(/\[(CONFIRM|DATE|SUPPORT EMAIL|REPORT EMAIL)/);
    });
  }
});
