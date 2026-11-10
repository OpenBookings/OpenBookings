import type { Metadata } from "next";
import { getServerSession } from "@/lib/auth";
import { readGuestProfile } from "@/lib/account/guest-details";
import { PageHeader } from "../_components/section";
import { PersonalDetailsForm } from "./_components/PersonalDetailsForms";
import { COUNTRIES, DIAL_CODES } from "@/lib/account/countries";
import { splitPhone } from "./_lib/phone";

export const metadata: Metadata = { title: "Personal details" };
export const dynamic = "force-dynamic";

export default async function PersonalDetailsPage() {
  const session = await getServerSession();
  if (!session) return null; // The layout shows the sign-in form.

  const { phone, address } = await readGuestProfile(session.user.id);

  // A form reads best narrow, so this page doesn't take the account area's full width.
  return (
    <div className="flex w-full max-w-[640px] flex-col gap-6">
      <PageHeader title="Personal details" />
      <PersonalDetailsForm
        name={session.user.name ?? ""}
        phone={splitPhone(phone, address?.country ?? "NL")}
        address={address}
        countries={COUNTRIES}
        dialCodes={DIAL_CODES}
      />
    </div>
  );
}
