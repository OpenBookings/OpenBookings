/**
 * Validation for the Personal details page. The page saves everything with
 * one button; `parseDetails` runs the per-field parsers and reports all their
 * errors at once. Plain functions, shared by the server action (the control)
 * and nothing else: the browser's own `required`/`maxLength` are a convenience.
 */

import { joinPhone } from "./phone";

export type Address = {
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  country: string;
};

export type Parsed<T, F extends string> = { ok: true; value: T } | { ok: false; errors: Partial<Record<F, string>> };

/** ISO 3166-1 alpha-2, current codes only. Guests can live anywhere, so this is not EU-only. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
  "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
  "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

const COUNTRIES = new Set(COUNTRY_CODES);

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function parseName(form: FormData): Parsed<string, "name"> {
  const name = text(form, "name");
  if (!name) return { ok: false, errors: { name: "Enter your name." } };
  if (name.length > 100) return { ok: false, errors: { name: "Use 100 characters or fewer." } };
  return { ok: true, value: name };
}

export const PHONE_ERROR = "Check the number and the country code.";

/** `phone` is the number as typed, `phoneCountry` the picked country; stored in international format. */
export function parsePhone(form: FormData): Parsed<string | null, "phone"> {
  const phone = text(form, "phone");
  if (!phone) return { ok: true, value: null };
  const joined = joinPhone(phone, text(form, "phoneCountry").toUpperCase());
  return joined ? { ok: true, value: joined } : { ok: false, errors: { phone: PHONE_ERROR } };
}

type AddressField = "line1" | "line2" | "postalCode" | "city" | "country";

const LIMITS: Record<AddressField, number> = { line1: 200, line2: 200, postalCode: 20, city: 100, country: 2 };
const MISSING: Record<Exclude<AddressField, "line2">, string> = {
  line1: "Enter a street and number.",
  postalCode: "Enter a postcode.",
  city: "Enter a city.",
  country: "Choose a country.",
};

/** All or nothing: an empty form clears the address, a partial one names what is missing. */
export function parseAddress(form: FormData): Parsed<Address | null, AddressField> {
  const raw = {
    line1: text(form, "line1"),
    line2: text(form, "line2"),
    postalCode: text(form, "postalCode"),
    city: text(form, "city"),
    country: text(form, "country").toUpperCase(),
  };
  if (Object.values(raw).every((v) => v === "")) return { ok: true, value: null };

  const errors: Partial<Record<AddressField, string>> = {};
  for (const field of Object.keys(MISSING) as (keyof typeof MISSING)[]) {
    if (!raw[field]) errors[field] = MISSING[field];
  }
  for (const field of Object.keys(LIMITS) as AddressField[]) {
    if (raw[field].length > LIMITS[field] && !errors[field]) errors[field] = `Use ${LIMITS[field]} characters or fewer.`;
  }
  if (raw.country && !COUNTRIES.has(raw.country)) errors.country = MISSING.country;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { ...raw, line2: raw.line2 || null } };
}

export type Details = { name: string; phone: string | null; address: Address | null };

/** The whole form: valid only when every part is, with every part's errors. */
export function parseDetails(form: FormData): Parsed<Details, "name" | "phone" | AddressField> {
  const name = parseName(form);
  const phone = parsePhone(form);
  const address = parseAddress(form);
  if (name.ok && phone.ok && address.ok) {
    return { ok: true, value: { name: name.value, phone: phone.value, address: address.value } };
  }
  return {
    ok: false,
    errors: {
      ...(name.ok ? {} : name.errors),
      ...(phone.ok ? {} : phone.errors),
      ...(address.ok ? {} : address.errors),
    },
  };
}

export const PHONE_REQUIRED = "Enter a phone number so the hotel can reach you.";

export type DetailsField = "name" | "phone" | AddressField;

/** What checkout needs: the account page's details, with phone and address required. */
export type CheckoutDetails = { name: string; phone: string; address: Address };

/**
 * Checkout's rules. The host needs a number and an address for every paid
 * booking (arrival contact, guest register), so here they are required; the
 * account page keeps them optional.
 */
export function parseCheckoutDetails(form: FormData): Parsed<CheckoutDetails, DetailsField> {
  const name = parseName(form);
  const phone = parsePhone(form);
  const address = parseAddress(form);
  const errors: Partial<Record<DetailsField, string>> = {
    ...(name.ok ? {} : name.errors),
    ...(phone.ok ? (phone.value === null ? { phone: PHONE_REQUIRED } : {}) : phone.errors),
    ...(address.ok ? (address.value === null ? { ...MISSING } : {}) : address.errors),
  };
  if (name.ok && phone.ok && phone.value !== null && address.ok && address.value !== null) {
    return { ok: true, value: { name: name.value, phone: phone.value, address: address.value } };
  }
  return { ok: false, errors };
}
