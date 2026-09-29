import type { LegalLocale } from "./documents";

/**
 * Chrome strings for a legal document.
 *
 * The prose lives in MDX, one file per locale, but the frame around it —
 * navigation, the "Why / Legal basis" labels inside a `DataCard`, and the two
 * banners — is rendered by components and so cannot be translated in the
 * document itself. A Dutch policy under an English "Last updated" heading
 * reads as half-shipped, and the draft banner in particular has to be legible
 * to exactly the reader who cannot read the authoritative English text.
 *
 * Sentences that contain a link are stored as the fragments around it rather
 * than as a template with a placeholder: the word order differs per language
 * (Dutch puts the verb last, French inflects the adjective), and fragments
 * keep that visible to whoever edits the translation.
 */
export type LegalStrings = {
  /** Back-to-home link in the header. */
  back: string;
  /** Eyebrow above the document title. */
  eyebrow: string;
  onThisPage: string;
  /** `aria-label` on the table-of-contents nav. */
  tableOfContents: string;
  /** Heading and `aria-label` on the language switcher. */
  language: string;
  lastUpdated: string;
  effective: string;
  version: string;
  why: string;
  legalBasis: string;
  draft: {
    title: string;
    before: string;
    /**
     * How this language names each other language's document, e.g. the Dutch
     * page calls the English one "Engelse versie". Keyed by the document's
     * fallback locale, which is the text that actually governs.
     */
    authoritative: Record<LegalLocale, string>;
    after: string;
  };
  superseded: {
    title: string;
    beforeVersion: string;
    afterVersion: string;
    currentVersion: string;
    afterLink: string;
  };
};

export const LEGAL_STRINGS: Record<LegalLocale, LegalStrings> = {
  en: {
    back: "Back",
    eyebrow: "Legal",
    onThisPage: "On this page",
    tableOfContents: "Table of contents",
    language: "Language",
    lastUpdated: "Last updated:",
    effective: "Effective:",
    version: "Version",
    why: "Why:",
    legalBasis: "Legal basis:",
    draft: {
      title: "Unreviewed translation",
      before:
        "This translation has not been through legal review and is not the authoritative version. The ",
      authoritative: {
        en: "English version",
        nl: "Dutch version",
        fr: "French version",
      },
      after: " governs.",
    },
    superseded: {
      title: "Superseded version",
      beforeVersion: "You are reading version ",
      afterVersion:
        ", kept available because it governs anything agreed while it was in force. The ",
      currentVersion: "current version",
      afterLink: " applies to everything else.",
    },
  },

  nl: {
    back: "Terug",
    eyebrow: "Juridisch",
    onThisPage: "Op deze pagina",
    tableOfContents: "Inhoudsopgave",
    language: "Taal",
    lastUpdated: "Laatst bijgewerkt:",
    effective: "Van kracht:",
    version: "Versie",
    why: "Waarom:",
    legalBasis: "Rechtsgrondslag:",
    draft: {
      title: "Niet-gecontroleerde vertaling",
      before:
        "Deze vertaling is niet juridisch getoetst en is niet de authentieke versie. De ",
      authoritative: {
        en: "Engelse versie",
        nl: "Nederlandse versie",
        fr: "Franse versie",
      },
      after: " is leidend.",
    },
    superseded: {
      title: "Vervallen versie",
      beforeVersion: "U leest versie ",
      afterVersion:
        ", die beschikbaar blijft omdat zij geldt voor alles wat is overeengekomen toen zij van kracht was. De ",
      currentVersion: "huidige versie",
      afterLink: " geldt voor al het overige.",
    },
  },

  fr: {
    back: "Retour",
    eyebrow: "Mentions légales",
    onThisPage: "Sur cette page",
    tableOfContents: "Table des matières",
    language: "Langue",
    lastUpdated: "Dernière mise à jour :",
    effective: "En vigueur :",
    version: "Version",
    why: "Pourquoi :",
    legalBasis: "Base légale :",
    draft: {
      title: "Traduction non relue",
      before:
        "Cette traduction n'a pas fait l'objet d'une relecture juridique et ne fait pas foi. La ",
      authoritative: {
        en: "version anglaise",
        nl: "version néerlandaise",
        fr: "version française",
      },
      after: " prévaut.",
    },
    superseded: {
      title: "Version remplacée",
      beforeVersion: "Vous lisez la version ",
      afterVersion:
        ", conservée car elle régit tout ce qui a été convenu pendant qu'elle était en vigueur. La ",
      currentVersion: "version actuelle",
      afterLink: " s'applique à tout le reste.",
    },
  },
};
