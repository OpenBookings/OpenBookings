import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { VerifyStep } from "../_steps/verify";
import { getOnboardingRow, getOnboardingStatus, resolveOnboardingRedirect } from "../_lib/status";

export default async function StripePage() {
  const session = await getServerSession();

  const row = await getOnboardingRow(session!.user.id);
  const target = resolveOnboardingRedirect(row);
  if (target) redirect(target);

  const initialStatus = await getOnboardingStatus(row);
  return <VerifyStep initialStatus={initialStatus} />;
}
