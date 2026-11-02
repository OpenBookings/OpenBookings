import { getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { getExampleNumber } from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";
import metadata from "libphonenumber-js/min/metadata";

/**
 * Phone numbers are stored as one international string ("+31 6 12345678").
 * The form shows them as a country picker (flag and dialling code) plus the
 * rest of the number. These helpers convert between the two.
 */

/** A flag emoji from an ISO 3166-1 alpha-2 code. Windows shows the two letters instead. */
export function flag(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function dialCode(country: string): string | null {
  return isSupportedCountry(country) ? getCountryCallingCode(country) : null;
}

/** A sample mobile number for the country, without its code: the field's placeholder. */
export function examplePhone(country: string): string {
  if (!isSupportedCountry(country)) return "";
  const example = getExampleNumber(country, examples);
  if (!example) return "";
  return example.formatInternational().slice(`+${example.countryCallingCode} `.length);
}

/**
 * Splits a stored number for the form. Numbers saved before the picker
 * existed may not parse; those keep their text and get the fallback country.
 */
export function splitPhone(stored: string | null, fallback: string): { country: string; number: string } {
  const country = isSupportedCountry(fallback) ? fallback : "NL";
  if (!stored) return { country, number: "" };
  const parsed = parsePhoneNumberFromString(stored);
  if (!parsed) return { country, number: stored };
  // Several countries share a code (+44: GB, GG, IM, JE) and the small dataset
  // can't always tell them apart. The guest's own country wins, then the main one.
  const sharing = metadata.country_calling_codes[parsed.countryCallingCode] ?? [];
  const picked = sharing.includes(country) ? country : (sharing[0] ?? parsed.country);
  if (!picked) return { country, number: stored };
  const prefix = `+${parsed.countryCallingCode} `;
  const international = parsed.formatInternational();
  return {
    country: picked,
    number: international.startsWith(prefix) ? international.slice(prefix.length) : parsed.nationalNumber,
  };
}

/**
 * The number as stored, or null when it isn't a valid number. A number typed
 * with its own "+" code wins over the picked country.
 */
export function joinPhone(number: string, country: string): string | null {
  const parsed = parsePhoneNumberFromString(number, isSupportedCountry(country) ? (country as CountryCode) : undefined);
  return parsed?.isValid() ? parsed.formatInternational() : null;
}
