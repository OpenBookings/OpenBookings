import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
import { queryOne } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";
import { PageHeader } from "../_components/section";
import { AddressForm, NameForm, PhoneForm } from "./_components/PersonalDetailsForms";
import { COUNTRY_CODES, type Address } from "./_lib/validate";

const regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" });
const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: regionNames.of(code) ?? code })).sort((a, b) =>
  a.name.localeCompare(b.name, "en-GB"),
);

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
          country: profile.country.trim(),
        }
      : null;

  return (
    <>
      <PageHeader title="Personal details" description="Who you are on your bookings, and how properties can reach you." />
      <NameForm name={session.user.name ?? ""} />
      <PhoneForm phone={profile?.phone ?? null} />
      <AddressForm address={address} countries={COUNTRIES} />
      <p className="flex items-start gap-2 border-t pt-5 text-[13px] text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Your phone number and address are shared only with the properties you book.{" "}
          <Link href="/legal/en/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy policy
          </Link>
        </span>
      </p>
    </>
  );
}
