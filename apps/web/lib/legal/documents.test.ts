import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MESSAGE_RETENTION_DAYS } from "@openbookings/messaging/redaction";
import { MASKED_TEXT, MODERATION_DEADLINE_HOURS, MODERATION_RECORD_RETENTION_MONTHS } from "@openbookings/pricing";
import { getCurrentVersion, getDocument, getVersion, LEGAL_LOCALES } from "./documents";

const CURRENT = "2026-11-27";
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

  test("the previous current versions stay registered", () => {
    expect(getVersion(doc, "2026-11-16")).toBeDefined();
    expect(getVersion(doc, "2026-11-23")).toBeDefined();
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
        "Neon", "Scaleway", "Algolia", "MapTiler", "Lettermint", "PostHog", "Sentry", "Cloudflare", "Stripe",
        // Reviews cache and support task queue; support inbox; support assistant.
        "Upstash", "Chatwoot", "Mistral",
      ]) {
        expect(source).toContain(`**${vendor}**`);
      }
    });

    test(`${locale}: does not name vendors that get no guest data`, () => {
      const source = read(CURRENT, locale);
      // Whole words, any case: "Cartographie" is not CartoDB, "CARTO" is.
      for (const absent of ["Google Cloud", "Tirreno", "Carto", "CartoDB", "Dicebear", "Microsoft"]) {
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
      expect(source).toMatch(
        new RegExp(`\\| (Messages|Berichten) \\| ${DEFAULT_MESSAGE_RETENTION_DAYS} (days|dagen|jours)`),
      );
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

    test(`${locale}: keeps account data until the account is deleted`, () => {
      const row = read(CURRENT, locale)
        .split("\n")
        .find((l) => /^\| (Account data|Accountgegevens|Données de compte) \|/.test(l))!;
      // No inactive-account purge exists.
      expect(row).not.toMatch(/last login|laatste login|dernière connexion/);
      expect(row).toMatch(/delete your account|uw account verwijdert|suppression de votre compte/);
    });

    test(`${locale}: support is by email, with no AI answering first`, () => {
      const source = read(CURRENT, locale);
      expect(source).not.toMatch(/answers first|antwoordt eerst|répond en premier/);
      expect(source).toMatch(/ask for a person|om een medewerker vragen|parler à une personne/);
    });

    test(`${locale}: sets the same minimum age as the Terms (18)`, () => {
      const source = read(CURRENT, locale);
      expect(source).toMatch(/under 18|onder de 18 jaar|moins de 18 ans/);
      expect(source).not.toMatch(/under 16|onder de 16|moins de 16/);
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
    expect(read("2026-11-16", "en")).toContain("Our AI assistant answers first.");
    expect(read("2026-11-23", "en")).toContain(
      "Reviews that contain contact details or links are held until our team has checked them.",
    );
  });
});

// Review moderation (2026-11-27). Mistral's terms as Wouter confirmed them from
// its Data Processing Addendum: EEA hosting, SCCs for sub-processors outside the
// EU, kept for the contract and deleted within 30 days after it, no training.
// Our side: packages/db/src/reviews/{reports,moderation}.ts and
// apps/web/lib/reviews/report-actions.ts.
const MODERATION: Record<(typeof LEGAL_LOCALES)[number], {
  purpose: string;
  region: string;
  dpa: RegExp;
  training: RegExp;
  retention30: RegExp;
  onlyText: RegExp;
  reportsRow: string;
  textsRow: string;
  months: string;
  afterDecision: string;
  afterMade: string;
  deadline: string;
  reporterAccount: RegExp;
  reporterEmail: RegExp;
  ipNotSaved: RegExp;
  personRemoves: RegExp;
  stale: RegExp;
}> = {
  en: {
    purpose: "checking reviews and replies",
    region: "| EEA |",
    dpa: /processor, under its Data Processing Addendum/,
    training: /doesn't use what we send it to train its models/,
    retention30: /for as long as our contract with it runs and deletes it within 30 days after that ends/,
    onlyText: /no score, name, property or booking/,
    reportsRow: "Reports about reviews",
    textsRow: "Original text of a removed review or answer, or of one published with parts replaced",
    months: "months",
    afterDecision: "after the decision",
    afterMade: "after it was made",
    deadline: `If nobody has decided within ${MODERATION_DEADLINE_HOURS} hours`,
    reporterAccount: /If you're signed in, we also keep your account with the report/,
    reporterEmail: /If you ask for updates, we also keep your account's email address/,
    ipNotSaved: /IP address only to limit how many reports can be sent from it; it isn't saved/,
    personRemoves: /Only a person can remove a review or an answer/,
    stale: /contain contact details or links are held/,
  },
  nl: {
    purpose: "beoordelingen en reacties controleren",
    region: "| EER |",
    dpa: /verwerker, onder zijn verwerkersovereenkomst \(Data Processing Addendum\)/,
    training: /niet om zijn modellen te trainen/,
    retention30: /zolang ons contract met Mistral loopt en verwijdert ze binnen 30 dagen nadat het is beëindigd/,
    onlyText: /zonder cijfer, naam, accommodatie of boeking/,
    reportsRow: "Meldingen over beoordelingen",
    textsRow: "Oorspronkelijke tekst van een verwijderde beoordeling of een verwijderd antwoord, of van een tekst die met vervangen delen is gepubliceerd",
    months: "maanden",
    afterDecision: "na het besluit",
    afterMade: "nadat ze is gedaan",
    deadline: `Heeft niemand binnen ${MODERATION_DEADLINE_HOURS} uur besloten`,
    reporterAccount: /Bent u ingelogd, dan bewaren wij ook uw account bij de melding/,
    reporterEmail: /Vraagt u om updates, dan bewaren wij ook het e-mailadres van uw account/,
    ipNotSaved: /IP-adres alleen om te beperken hoeveel meldingen ervandaan kunnen worden verstuurd; het wordt niet/,
    personRemoves: /Alleen een medewerker kan een beoordeling of een antwoord verwijderen/,
    stale: /met contactgegevens of links houden wij vast/,
  },
  fr: {
    purpose: "vérification des avis et des réponses",
    region: "| EEE |",
    dpa: /sous-traitant, dans le cadre de son avenant relatif au traitement des données \(Data Processing Addendum\)/,
    training: /n'utilise pas ce que nous lui envoyons pour entraîner ses modèles/,
    retention30: /pendant toute la durée de notre contrat avec Mistral et les supprime dans les 30 jours suivant sa fin/,
    onlyText: /sans note, nom, établissement ni réservation/,
    reportsRow: "Signalements d'avis",
    textsRow: "Texte d'origine d'un avis ou d'une réponse supprimés, ou publiés avec des passages remplacés",
    months: "mois",
    afterDecision: "après la décision",
    afterMade: "après sa création",
    deadline: `Si personne n'a décidé dans les ${MODERATION_DEADLINE_HOURS} heures`,
    reporterAccount: /Si vous êtes connecté, nous conservons aussi votre compte avec le signalement/,
    reporterEmail: /Si vous demandez des nouvelles, nous conservons aussi l'adresse e-mail de votre compte/,
    ipNotSaved: /adresse IP uniquement pour limiter le nombre de signalements envoyés depuis celle-ci ; elle n'est pas enregistrée/,
    personRemoves: /Seule une personne peut supprimer un avis ou une réponse/,
    stale: /contenant des coordonnées ou des liens sont retenus/,
  },
};

describe("current privacy policy: review moderation", () => {
  for (const locale of LEGAL_LOCALES) {
    const m = MODERATION[locale];
    const source = () => read(CURRENT, locale);
    const row = (start: string) => source().split("\n").find((l) => l.startsWith(start));

    test(`${locale}: Mistral checks review text, in the EEA, with the text only`, () => {
      const mistral = row("| **Mistral**")!;
      expect(mistral).toContain(m.purpose);
      expect(mistral).toContain(m.region);
      expect(mistral).toMatch(m.onlyText);
    });

    test(`${locale}: Mistral's DPA, retention and no training are stated`, () => {
      expect(source()).toMatch(m.dpa);
      expect(source()).toMatch(m.training);
      expect(source()).toMatch(m.retention30);
    });

    test(`${locale}: reports and moderated texts are kept ${MODERATION_RECORD_RETENTION_MONTHS} months`, () => {
      const months = `${MODERATION_RECORD_RETENTION_MONTHS} ${m.months}`;
      const reports = row(`| ${m.reportsRow} |`);
      expect(reports).toBeDefined();
      expect(reports).toContain(`${months} ${m.afterDecision}`);
      expect(reports).toContain(`${months} ${m.afterMade}`);
      const texts = row(`| ${m.textsRow} |`);
      expect(texts).toBeDefined();
      expect(texts).toContain(`${months} ${m.afterDecision}`);
      // No other number of months is given for either.
      for (const r of [reports!, texts!]) {
        for (const n of r.matchAll(new RegExp(`(\\d+) ${m.months}`, "g"))) {
          expect(Number(n[1])).toBe(MODERATION_RECORD_RETENTION_MONTHS);
        }
      }
    });

    test(`${locale}: describes the check, the deadline and the masking`, () => {
      expect(source()).toContain(m.deadline);
      expect(source()).toContain(MASKED_TEXT);
      expect(source()).toMatch(m.personRemoves);
      expect(source()).toContain("/legal/review-rules");
    });

    test(`${locale}: lists what a report holds about the reporter`, () => {
      expect(source()).toMatch(m.reporterAccount);
      expect(source()).toMatch(m.reporterEmail);
      expect(source()).toMatch(m.ipNotSaved);
    });

    test(`${locale}: no longer says only contact details or links hold a review`, () => {
      expect(source()).not.toMatch(m.stale);
    });
  }
});
