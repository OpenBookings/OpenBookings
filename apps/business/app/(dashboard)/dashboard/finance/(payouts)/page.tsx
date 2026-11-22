import { StatusBadge } from "@/components/ui/status-badge";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { NoAccessPage } from "@/components/dashboard/no-access-page";
import { pageAccess } from "@/lib/page-access";
import { loadPayoutStatus } from "@/lib/finance/payout-status";
import { activeOrgId } from "@/lib/active-org";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageHold } from "@/components/dashboard/page-loaders";

export default async function FinancePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const access = await pageAccess("payouts");
  if (access.level === "none") {
    return (
      <PageHold id="payouts" fill>
        <NoAccessPage navKey="payouts" current={access.current} />
      </PageHold>
    );
  }
  // With no current hotel, the role that decides is the one in the session's org.
  const orgId = access.current ? null : await activeOrgId(session);
  const payouts = await loadPayoutStatus(access.current, { userId: session.user.id, orgId });

  return (
    <PageHold id="payouts">
      <PageHeader
        title="Payouts"
        description="See whether Stripe is paying your guests' payments out to your bank."
        className="px-4 lg:px-6"
      />
      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Payouts
              {payouts.state === "ok" ? (
                <StatusBadge tone={payouts.payoutsEnabled ? "positive" : "attention"}>
                  {payouts.payoutsEnabled ? "Active" : "Paused"}
                </StatusBadge>
              ) : null}
            </CardTitle>
            <CardDescription>
              Guest payments go straight to your own Stripe account, and
              Stripe pays them out to your bank. OpenBookings never holds
              your money.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {payouts.state === "hidden" ? (
              <p className="text-muted-foreground">
                Payouts are visible to owners, general managers and back office.
              </p>
            ) : null}
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
    </PageHold>
  );
}
