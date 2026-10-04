import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOnboardingRow, resolveOnboardingRedirect } from "./_lib/status";

export default async function OnboardingPage() {
  // proxy.ts already guarantees a valid, business-typed session for every
  // request under /onboarding/*, so this only needs the user id.
  const session = await getServerSession();

  const row = await getOnboardingRow(session!.user.id);
  redirect(resolveOnboardingRedirect(row) ?? "/onboarding/stripe");
}
