import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOnboardingRow, resolveOnboardingRedirect } from "./_lib/status";

export default async function OnboardingPage() {
  // proxy.ts already guarantees a valid, business-typed session for every
  // request under /onboarding/*, so this only needs the user id.
  const session = await getServerSession();

  const row = await getOnboardingRow(session!.user.id);
  const target = resolveOnboardingRedirect(row);

  // Rendered, not redirected: the wizard is done and the dashboard would send
  // this user straight back here.
  if (target === "no-access") {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <h2 className="text-lg font-semibold text-white">
          You no longer have access to this organisation
        </h2>
        <p className="text-sm text-white/45 max-w-sm">
          You were removed from the organisation you set up. Ask one of its owners to invite
          you again if you still need access.
        </p>
      </div>
    );
  }

  redirect(target ?? "/onboarding/stripe");
}
