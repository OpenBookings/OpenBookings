import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentVersion, getDocument, getVersion, LEGAL_LOCALES } from "./documents";

const DIR = join(import.meta.dir, "../../content/legal/privacy");
const read = (version: string, locale: string) =>
  readFileSync(join(DIR, version, `${locale}.mdx`), "utf8");
const sectionIds = (source: string) =>
  [...source.matchAll(/<Section id="([^"]+)"/g)].map((m) => m[1]);

describe("privacy policy registry", () => {
  const doc = getDocument("privacy")!;

  test("2026-10-02 is the current version", () => {
    expect(getCurrentVersion(doc).version).toBe("2026-10-02");
  });

  test("the superseded version stays registered for its archive URL", () => {
    const old = getVersion(doc, "2026-09-21");
    expect(old).toBeDefined();
    expect(Object.keys(old!.locales).sort()).toEqual(["en", "fr", "nl"]);
  });

  test("only English is marked translated", () => {
    const { locales } = getCurrentVersion(doc);
    expect(locales.en?.status).toBe("translated");
    expect(locales.nl?.status).toBe("draft");
    expect(locales.fr?.status).toBe("draft");
  });
});

describe("privacy policy 2026-10-02 content", () => {
  for (const locale of LEGAL_LOCALES) {
    test(`${locale}: names the real vendors`, () => {
      const source = read("2026-10-02", locale);
      for (const vendor of ["Neon", "Scaleway", "Algolia", "MapTiler", "Lettermint", "PostHog", "Sentry", "Cloudflare", "Stripe"]) {
        expect(source).toContain(`**${vendor}**`);
      }
    });

    test(`${locale}: does not name vendors that get no guest data`, () => {
      const source = read("2026-10-02", locale);
      for (const absent of ["Google Cloud", "Tirreno", "Chatwoot", "Mistral", "Carto", "Dicebear", "Microsoft", "Upstash"]) {
        expect(source).not.toContain(absent);
      }
    });

    test(`${locale}: Cloudflare row claims only what the guest site sends it`, () => {
      const row = read("2026-10-02", locale).split("\n").find((l) => l.startsWith("| **Cloudflare**"))!;
      // Guest messaging and Cloudflare rate limiting are not live on the guest site.
      expect(row).not.toMatch(/messag|bericht|limit|snelheid|débit/i);
    });

    test(`${locale}: discloses that Sentry receives page-load timing, not only errors`, () => {
      const source = read("2026-10-02", locale);
      const row = source.split("\n").find((l) => l.startsWith("| **Sentry**"))!;
      expect(row).toMatch(/timing|laadtijd|temps de chargement/i);
    });

    test(`${locale}: keeps the same section ids as the previous version`, () => {
      expect(sectionIds(read("2026-10-02", locale))).toEqual(sectionIds(read("2026-09-21", "en")));
    });
  }

  test("the previous version's files are untouched", () => {
    expect(read("2026-09-21", "en")).toContain("**Google Cloud**");
  });
});
