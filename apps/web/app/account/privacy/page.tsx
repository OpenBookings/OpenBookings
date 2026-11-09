import type { Metadata } from "next";
import { getPool } from "@openbookings/db";
import { reviewEmailsEnabled } from "@openbookings/db/reviews";
import { getServerSession } from "@/lib/auth";
import { PageHeader } from "../_components/section";
import { PrivacyPanel } from "./_components/PrivacyPanel";

export const metadata: Metadata = { title: "Privacy & data" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const session = await getServerSession();
  if (!session) return null; // The layout shows the sign-in form.
  const reviewEmails = await reviewEmailsEnabled(getPool(), session.user.id);

  return (
    <>
      <PageHeader title="Privacy & data" description="Your cookie choices, review emails, a copy of your data, and closing your account." />
      <PrivacyPanel email={session.user.email} reviewEmails={reviewEmails} />
    </>
  );
}
