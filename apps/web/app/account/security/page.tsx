import type { Metadata } from "next";
import { getServerSession } from "@/lib/auth";
import { PageHeader } from "../_components/section";
import { SecurityPanel } from "./_components/SecurityPanel";

export const metadata: Metadata = { title: "Sign-in & security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await getServerSession();
  if (!session) return null; // The layout shows the sign-in form.

  return (
    <>
      <PageHeader title="Sign-in & security" description="How you sign in, and every device that's signed in to your account." />
      <SecurityPanel email={session.user.email} />
    </>
  );
}
