import { Suspense } from "react";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { PageHeader } from "@/components/dashboard/page-header";
import { SiteHeader } from "@/components/dashboard/site-header";
import { PageHold, PageLoading } from "@/components/dashboard/page-loaders";
import { currentSupportScope } from "@/lib/support/server/bootstrap";
import { listTickets } from "@/lib/support/server/tickets";
import { parseTicketTab } from "@/lib/support/status";
import { TicketsView } from "./_components/tickets-view";

type PageProps = {
  searchParams: Promise<{ tab?: string; page?: string; ticket?: string }>;
};

export default function SupportPage({ searchParams }: PageProps) {
  return (
    <>
      <SiteHeader title="Support" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            <Suspense fallback={<PageLoading id="support" />}>
              <PageHold id="support">
                <PageHeader
                  title="Support"
                  description="Ask us about bookings, payouts or your listing, and follow each ticket here."
                  className="px-4 lg:px-6"
                />
                <Tickets searchParams={searchParams} />
              </PageHold>
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}

async function Tickets({ searchParams }: PageProps) {
  // Null while SUPPORT_CHAT_ENABLED is off (or without a verified org).
  const scope = await currentSupportScope();
  if (!scope) return <ComingSoon title="Support" />;

  const params = await searchParams;
  const tab = parseTicketTab(params.tab);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const data = await listTickets(scope, { tab, page });

  return (
    <TicketsView
      tab={tab}
      page={page}
      tickets={data.tickets}
      counts={data.counts}
      hasNextPage={data.hasNextPage}
      showOpenedBy={data.showOpenedBy}
      openTicketId={params.ticket ?? null}
    />
  );
}
