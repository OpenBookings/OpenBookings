import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentVersion, getDocument, getVersion, LEGAL_LOCALES } from "./documents";

const CURRENT = "2026-12-21";
const DIR = join(import.meta.dir, "../../content/legal/privacy");
const read = (version: string, locale: string) =>
  readFileSync(join(DIR, version, `${locale}.mdx`), "utf8");
const sectionIds = (source: string) =>
  [...source.matchAll(/<Section id="([^"]+)"/g)].map((m) => m[1]);

// Regions as confirmed for the 2026-10-02 version, per language.
const REGIONS: Record<(typeof LEGAL_LOCALES)[number], Record<string, string>> = {
// TomTom: its data processing schedule names EU data centre locations only.
  en: { Neon: "EU (Frankfurt)", Scaleway: "EU (Amsterdam)", TomTom: "EU", Sentry: "EU (Germany)" },
  nl: { Neon: "EU (Frankfurt)", Scaleway: "EU (Amsterdam)", TomTom: "EU", Sentry: "EU (Duitsland)" },
  fr: { Neon: "UE (Francfort)", Scaleway: "UE (Amsterdam)", TomTom: "UE", Sentry: "UE (Allemagne)" },
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
      for (const vendor of [
        "Neon", "Scaleway", "Algolia", "TomTom", "Lettermint", "PostHog", "Sentry", "Cloudflare", "Stripe",
        // Reviews cache and support task queue; support inbox; support assistant.
        "Upstash", "Chatwoot", "Mistral",
      ]) {
        expect(source).toContain(`**${vendor}**`);
      }
    });

    test(`${locale}: does not name vendors that get no guest data`, () => {
      const source = read(CURRENT, locale);
      // Whole words, any case: "Cartographie" is not CartoDB, "CARTO" is.
      for (const absent of ["Google Cloud", "Tirreno", "Carto", "CartoDB", "Dicebear", "Microsoft", "MapTiler"]) {
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

    test(`${locale}: Cloudflare row covers live message delivery, but not rate limiting`, () => {
      const row = read(CURRENT, locale).split("\n").find((l) => l.startsWith("| **Cloudflare**"))!;
      // Live guest messages go through a Cloudflare Worker (packages/messaging/src/realtime.ts).
      expect(row).toMatch(/messag|bericht/i);
      // Cloudflare rate limiting is not live on the guest site.
      expect(row).not.toMatch(/limit|snelheid|débit/i);
    });

    test(`${locale}: Upstash row names the cached reviews`, () => {
      const row = read(CURRENT, locale).split("\n").find((l) => l.startsWith("| **Upstash**"))!;
      expect(row).toMatch(/review|beoordeling|avis/i);
    });

    test(`${locale}: email pixels are disclosed, and only with consent`, () => {
      const source = read(CURRENT, locale);
      expect(source).not.toMatch(/No tracking pixels|Geen trackingpixels|Aucun pixel de suivi/);
      expect(source).toMatch(/invisible image|onzichtbaar plaatje|image invisible/);
    });

    test(`${locale}: lists the account data the export holds`, () => {
      const source = read(CURRENT, locale);
      // apps/web/lib/account/export.ts: phone, address, passkeys, sessions (IP), liked rooms.
      expect(source).toMatch(/phone|telefoon|téléphone/i);
      expect(source).toMatch(/passkey|clés d'accès/i);
      expect(source).toMatch(/IP/);
    });

    test(`${locale}: states message and booking-note retention`, () => {
      const source = read(CURRENT, locale);
      expect(source).toMatch(/\| (Messages|Berichten) \| 365 (days|dagen|jours)/);
      expect(source).toMatch(/18 (months|maanden|mois)/);
    });

    test(`${locale}: points hosts at the Host Agreement, not the old Partner Agreement`, () => {
      const source = read(CURRENT, locale);
      expect(source).toMatch(/Host Agreement|Hostovereenkomst/);
      expect(source).not.toMatch(/Partner Agreement|Partnerovereenkomst|Contrat de partenariat/);
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
    expect(read("2026-11-15", "en")).toContain("No tracking pixels.");
    expect(read("2026-11-16", "en")).toContain("**MapTiler**");
  });

  test("the version before TomTom stays registered for its archive URL", () => {
    expect(getVersion(getDocument("privacy")!, "2026-11-16")).toBeDefined();
  });
});
