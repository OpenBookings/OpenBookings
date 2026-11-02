import type { Metadata } from "next";
import { queryOne } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";
import { PageHeader } from "../_components/section";
import { PersonalDetailsForm } from "./_components/PersonalDetailsForms";
import { dialCode, splitPhone } from "./_lib/phone";
import { COUNTRY_CODES, type Address } from "./_lib/validate";

const regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" });
const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: regionNames.of(code) ?? code })).sort((a, b) =>
  a.name.localeCompare(b.name, "en-GB"),
);

const DIAL_CODES = COUNTRIES.flatMap((c) => {
  const dial = dialCode(c.code);
  return dial ? [{ ...c, dial }] : [];
});

export const metadata: Metadata = { title: "Personal details" };
export const dynamic = "force-dynamic";

type ProfileRow = {
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
};

export default async function PersonalDetailsPage() {
  const session = await getServerSession();
  if (!session) return null; // The layout shows the sign-in form.

  const profile = await queryOne<ProfileRow>(
    `SELECT phone, address_line1, address_line2, postal_code, city, country FROM guest_profile WHERE user_id = $1`,
    [session.user.id],
  );
  const address: Address | null =
    profile?.address_line1 && profile.postal_code && profile.city && profile.country
      ? {
          line1: profile.address_line1,
          line2: profile.address_line2,
          postalCode: profile.postal_code,
          city: profile.city,
          // char(2) pads with spaces; saves store upper case, but rows written by hand may not.
          country: profile.country.trim().toUpperCase(),
        }
      : null;

  // A form reads best narrow, so this page doesn't take the account area's full width.
  return (
    <div className="flex w-full max-w-[640px] flex-col gap-6">
      <PageHeader title="Personal details" />
      <PersonalDetailsForm
        name={session.user.name ?? ""}
        phone={splitPhone(profile?.phone ?? null, address?.country ?? "NL")}
        address={address}
        countries={COUNTRIES}
        dialCodes={DIAL_CODES}
      />
    </div>
  );
}
