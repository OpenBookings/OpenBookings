import { parsePhoneNumberFromString } from "libphonenumber-js";
import { splitPhone } from "@/app/account/personal-details/_lib/phone";
import {
  parseCheckoutDetails,
  type Address,
  type CheckoutDetails,
} from "@/app/account/personal-details/_lib/validate";

/**
 * The guest's details as the checkout page receives them from their account:
 * the phone already split for the picker (`splitPhone`), the address only
 * when it is complete.
 */
export type GuestDetailsPrefill = {
  name: string;
  email: string;
  /**
   * `needsCheck`: the stored number had no "+" code (saved before the country
   * picker existed), so which country it belongs to is a guess. Checkout never
   * sends a guess to the hotel: the form opens on it instead.
   */
  phone: { country: string; number: string; needsCheck?: true };
  address: Address | null;
};

/** The same field names the account page's form posts. */
export function prefillToFormData(p: GuestDetailsPrefill): FormData {
  const data = new FormData();
  data.set("name", p.name);
  data.set("phone", p.phone.number);
  data.set("phoneCountry", p.phone.country);
  data.set("line1", p.address?.line1 ?? "");
  data.set("line2", p.address?.line2 ?? "");
  data.set("postalCode", p.address?.postalCode ?? "");
  data.set("city", p.address?.city ?? "");
  data.set("country", p.address?.country ?? "");
  return data;
}

/** The prefill for a guest, from what their account stores. */
export function prefillFromProfile(profile: {
  name: string;
  email: string;
  phone: string | null;
  address: Address | null;
}): GuestDetailsPrefill {
  const phone = splitPhone(profile.phone, profile.address?.country ?? "NL");
  // A stored number that doesn't parse on its own has no country of its own;
  // splitPhone has pinned it to the fallback, which may be wrong.
  const needsCheck = profile.phone !== null && profile.phone.trim() !== "" && !parsePhoneNumberFromString(profile.phone);
  return {
    name: profile.name,
    email: profile.email,
    phone: needsCheck ? { ...phone, needsCheck: true } : phone,
    address: profile.address,
  };
}

/** True when checkout can show the summary: everything it requires is saved and valid. */
export function isCompleteForCheckout(p: GuestDetailsPrefill): boolean {
  return !p.phone.needsCheck && parseCheckoutDetails(prefillToFormData(p)).ok;
}

export type StripeContact = {
  billingAddress: {
    name: string;
    address: { line1: string; line2: string | null; postal_code: string; city: string; country: string };
  };
  phoneNumber: string;
};

/** What `checkout.confirm` receives: Stripe's address shape and the phone in E.164. */
export function toStripeContact(d: CheckoutDetails): StripeContact {
  const { address: a } = d;
  return {
    billingAddress: {
      name: d.name,
      address: { line1: a.line1, line2: a.line2, postal_code: a.postalCode, city: a.city, country: a.country },
    },
    // Stored international ("+31 6 23456789"), so it always parses; the
    // fallback only strips spacing.
    phoneNumber: parsePhoneNumberFromString(d.phone)?.number ?? d.phone.replace(/[^\d+]/g, ""),
  };
}
