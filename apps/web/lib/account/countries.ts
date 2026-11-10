import { dialCode } from "@/app/account/personal-details/_lib/phone";
import { COUNTRY_CODES } from "@/app/account/personal-details/_lib/validate";

/**
 * Country and dialling-code lists for the personal details fields. Built on
 * the server and passed down: Node's and the browser's ICU name some
 * countries differently, so building them in a client component would break
 * hydration.
 */
const regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" });

export const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: regionNames.of(code) ?? code })).sort((a, b) =>
  a.name.localeCompare(b.name, "en-GB"),
);

export const DIAL_CODES = COUNTRIES.flatMap((c) => {
  const dial = dialCode(c.code);
  return dial ? [{ ...c, dial }] : [];
});
