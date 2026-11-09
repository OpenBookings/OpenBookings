import { parsePhoneNumberFromString } from "libphonenumber-js";
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
  phone: { country: string; number: string };
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

/** True when checkout can show the summary: everything it requires is saved and valid. */
export function isCompleteForCheckout(p: GuestDetailsPrefill): boolean {
  return parseCheckoutDetails(prefillToFormData(p)).ok;
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
