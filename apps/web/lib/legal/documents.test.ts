import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentVersion, getDocument, getVersion, LEGAL_LOCALES } from "./documents";

const CURRENT = "2026-10-03";
const DIR = join(import.meta.dir, "../../content/legal/privacy");
const read = (version: string, locale: string) =>
  readFileSync(join(DIR, version, `${locale}.mdx`), "utf8");
const sectionIds = (source: string) =>
  [...source.matchAll(/<Section id="([^"]+)"/g)].map((m) => m[1]);

// Regions as confirmed for the 2026-10-02 version, per language.
const REGIONS: Record<(typeof LEGAL_LOCALES)[number], Record<string, string>> = {
  en: { Neon: "EU (Frankfurt)", Scaleway: "EU (Amsterdam)", MapTiler: "EU (France and Ireland)", Sentry: "EU (Germany)" },
  nl: { Neon: "EU (Frankfurt)", Scaleway: "EU (Amsterdam)", MapTiler: "EU (Frankrijk en Ierland)", Sentry: "EU (Duitsland)" },
  fr: { Neon: "UE (Francfort)", Scaleway: "UE (Amsterdam)", MapTiler: "UE (France et Irlande)", Sentry: "UE (Allemagne)" },
};

describe("privacy policy registry", () => {
  const doc = getDocument("privacy")!;

  test("the newest version is current", () => {
    expect(getCurrentVersion(doc).version).toBe(CURRENT);
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

describe("current privacy policy content", () => {
  for (const locale of LEGAL_LOCALES) {
    test(`${locale}: names the real vendors`, () => {
      const source = read(CURRENT, locale);
      for (const vendor of ["Neon", "Scaleway", "Algolia", "MapTiler", "Lettermint", "PostHog", "Sentry", "Cloudflare", "Stripe"]) {
        expect(source).toContain(`**${vendor}**`);
      }
    });

    test(`${locale}: does not name vendors that get no guest data`, () => {
      const source = read(CURRENT, locale);
      // Whole words, any case: "Cartographie" is not CartoDB, "CARTO" is.
      for (const absent of ["Google Cloud", "Tirreno", "Chatwoot", "Mistral", "Carto", "CartoDB", "Dicebear", "Microsoft", "Upstash"]) {
        expect(source).not.toMatch(new RegExp(`\\b${absent}\\b`, "i"));
      }
    });

    test(`${locale}: states each vendor's confirmed region`, () => {
      const source = read(CURRENT, locale);
      const row = (vendor: string) => source.split("\n").find((l) => l.startsWith(`| **${vendor}**`))!;
      for (const [vendor, region] of Object.entries(REGIONS[locale])) {
        expect(row(vendor)).toContain(`| ${region} |`);
      }
    });

    test(`${locale}: Cloudflare row claims only what the guest site sends it`, () => {
      const row = read(CURRENT, locale).split("\n").find((l) => l.startsWith("| **Cloudflare**"))!;
      // Guest messaging and Cloudflare rate limiting are not live on the guest site.
      expect(row).not.toMatch(/messag|bericht|limit|snelheid|débit/i);
    });

    test(`${locale}: discloses that Sentry receives page-load timing, not only errors`, () => {
      const source = read(CURRENT, locale);
      const row = source.split("\n").find((l) => l.startsWith("| **Sentry**"))!;
      expect(row).toMatch(/timing|laadtijd|temps de chargement/i);
    });

    test(`${locale}: keeps the same section ids as the previous version`, () => {
      expect(sectionIds(read(CURRENT, locale))).toEqual(sectionIds(read("2026-09-21", "en")));
    });
  }

  for (const locale of LEGAL_LOCALES) {
    test(`${locale}: says the consent choice is also recorded server-side, without an IP address`, () => {
      const row = read(CURRENT, locale).split("\n").find((l) => l.includes("`ob_cookie_consent`"))!;
      expect(row).toMatch(/servers|servers\b|serveurs/i);
      expect(row).toContain("IP");
    });

    test(`${locale}: states how long consent records are kept`, () => {
      const row = read(CURRENT, locale)
        .split("\n")
        .find((l) => /^\| (Consent records|Toestemmingsregistraties|Preuves de consentement) \|/.test(l));
      expect(row).toBeDefined();
      expect(row).toMatch(/\| 5 (years|jaar|ans) \|/);
    });

    test(`${locale}: no longer tells visitors to clear storage to change their mind`, () => {
      expect(read(CURRENT, locale)).not.toMatch(/Clear this site's storage|Wis de opslag|Effacez les données de stockage/);
    });
  }

  test("superseded versions stay registered and readable", () => {
    const doc = getDocument("privacy")!;
    expect(getVersion(doc, "2026-10-02")).toBeDefined();
    expect(read("2026-10-02", "en")).toContain("**Scaleway**");
  });

  test("the previous version's files are untouched", () => {
    expect(read("2026-09-21", "en")).toContain("**Google Cloud**");
  });
});
