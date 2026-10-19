import { Suspense } from "react";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { SiteHeader } from "@/components/dashboard/site-header";
import { Skeleton } from "@/components/ui/skeleton";
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
            <Suspense fallback={<TicketsSkeleton />}>
              <Tickets searchParams={searchParams} />
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

function TicketsSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6" aria-hidden>
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex flex-col divide-y rounded-lg border">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
