import Link from "next/link";
import {
  LEGAL_LOCALE_FLAGS,
  LEGAL_LOCALE_LABELS,
  LEGAL_LOCALE_TAGS,
  type LegalLocale,
} from "@/lib/legal/documents";

/**
 * Segmented language control for the top bar.
 *
 * It lives in the header rather than the sidebar because the sidebar is
 * `hidden lg:block`: on a phone there was previously no way to switch language
 * at all, which matters most for the reader who cannot read the English
 * original.
 *
 * Each option shows a flag and the language code. The flag is decorative and
 * `aria-hidden` — "flag of Belgium" tells a screen-reader user nothing about
 * the language — while the endonym rides along in a visually hidden span, so
 * the accessible name is "FR Français" rather than a bare "FR". Where emoji
 * flags are unavailable (most Windows builds) a regional-indicator pair falls
 * back to the letters "BE", which is why the code is never dropped.
 */
export function LanguageSwitcher({
  locales,
  current,
  label,
  hrefFor,
  className,
}: {
  locales: LegalLocale[];
  /** The locale actually rendered, which is the one shown as selected. */
  current: LegalLocale;
  /** Already-translated "Language", used to name the landmark. */
  label: string;
  hrefFor: (locale: LegalLocale) => string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {locales.map((code) => {
          const isCurrent = code === current;

          return (
            <li key={code}>
              <Link
                href={hrefFor(code)}
                hrefLang={LEGAL_LOCALE_TAGS[code]}
                aria-current={isCurrent ? "true" : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-all duration-150 ${
                  isCurrent
                    ? "bg-white/10 font-medium text-white"
                    : "text-white/40 hover:bg-white/5 hover:text-white/70"
                }`}
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {LEGAL_LOCALE_FLAGS[code]}
                </span>
                <span>{code.toUpperCase()}</span>
                {/* `lang` sits on the endonym alone: the code above is read as
                    letters, but "Nederlands" has to be pronounced as Dutch. */}
                <span lang={LEGAL_LOCALE_TAGS[code]} className="sr-only">
                  {LEGAL_LOCALE_LABELS[code]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
