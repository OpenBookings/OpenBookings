import { redirect } from "next/navigation";
import { queryOne } from "@openbookings/db";
import { retrieveConnectAccount } from "@openbookings/stripe";
import { getServerSession } from "@/lib/auth";
import { SiteHeader } from "@/components/dashboard/site-header";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type PayoutStatus =
  | { state: "none" }
  | { state: "unavailable" }
  | { state: "ok"; payoutsEnabled: boolean; requirementsDue: number };

/**
 * Where the host's payouts stand, straight from Stripe. Read-only: no bank
 * details are fetched, shown or stored here. Those live in the host's own
 * Stripe Dashboard, behind Stripe's login.
 */
async function loadPayoutStatus(userId: string): Promise<PayoutStatus> {
  const row = await queryOne<{ stripe_account_id: string | null }>(
    `SELECT COALESCE(
       (SELECT op.stripe_account_id
          FROM "member" m JOIN org_profile op ON op.organization_id = m."organizationId"
         WHERE m."userId" = $1 AND op.stripe_account_id IS NOT NULL
         ORDER BY m."createdAt" LIMIT 1),
       (SELECT step_data->>'stripe_account_id' FROM host_onboarding WHERE user_id = $1)
     ) AS stripe_account_id`,
    [userId],
  );
  if (!row?.stripe_account_id) return { state: "none" };

  try {
    const account = await retrieveConnectAccount(row.stripe_account_id);
    return {
      state: "ok",
      payoutsEnabled: account.payouts_enabled ?? false,
      requirementsDue: account.requirements?.currently_due?.length ?? 0,
    };
  } catch {
    // Stripe being unreachable must not take the page down.
    return { state: "unavailable" };
  }
}

export default async function FinancePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const payouts = await loadPayoutStatus(session.user.id);

  return (
    <>
      <SiteHeader title="Finance" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            <div className="px-4 lg:px-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Payouts
                    {payouts.state === "ok" ? (
                      <Badge variant={payouts.payoutsEnabled ? "secondary" : "destructive"}>
                        {payouts.payoutsEnabled ? "Active" : "Paused"}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription>
                    Guest payments go straight to your own Stripe account, and
                    Stripe pays them out to your bank. OpenBookings never holds
                    your money.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  {payouts.state === "none" ? (
                    <p className="text-muted-foreground">No Stripe account is connected yet.</p>
                  ) : null}
                  {payouts.state === "unavailable" ? (
                    <p className="text-muted-foreground">
                      We couldn&apos;t reach Stripe just now. Your payouts are not affected.
                    </p>
                  ) : null}
                  {payouts.state === "ok" && payouts.requirementsDue > 0 ? (
                    <p>
                      Stripe needs {payouts.requirementsDue} more{" "}
                      {payouts.requirementsDue === 1 ? "detail" : "details"} from you. Payouts can
                      be paused until you provide {payouts.requirementsDue === 1 ? "it" : "them"}.
                    </p>
                  ) : null}
                  <p className="text-muted-foreground">
                    Your bank account, payout schedule, payments, refunds and
                    disputes are managed in your Stripe Dashboard.
                  </p>
                  <a
                    href="https://dashboard.stripe.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="self-start underline underline-offset-2"
                  >
                    Open Stripe Dashboard
                  </a>
                </CardContent>
              </Card>
            </div>
            <ComingSoon title="Finance" />
          </div>
        </div>
      </div>
    </>
  );
}
