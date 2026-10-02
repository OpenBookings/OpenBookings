import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { getPageData, isDemoParam } from "@/lib/analytics/get-analytics";
import { carryQuery, PAGES, type PageId } from "@/lib/analytics/pages";
import {
  amsterdamToday,
  parseCompareParam,
  parsePeriodParams,
  type RawParams,
} from "@/lib/analytics/period";
import { getReadiness } from "@/lib/analytics/readiness-query";
import { evaluateReadiness, NOT_STARTED, type ReadinessItem } from "@/lib/analytics/readiness";
import type { AnyPageData, PageData } from "@/lib/analytics/types";
import { getServerSession } from "@/lib/auth";
import { DemoBanner } from "./demo-banner";
import { GhostPage } from "./ghost-page";
import { PageHeader } from "./page-header";

export interface AnalyticsRouteProps {
  searchParams: Promise<RawParams>;
}

/** A checklist that could not be loaded shows every item as "Check", and the page still renders. */
async function loadReadiness(userId: string, today: string): Promise<ReadinessItem[]> {
  try {
    return await getReadiness(userId, today);
  } catch {
    return evaluateReadiness(NOT_STARTED).map((item) => ({ ...item, state: "unknown" as const }));
  }
}

/**
 * Everything the five pages share: the session check, the period, comparison
 * and demo flag from the URL, one getPageData() call, and the header, banner
 * and empty state around whichever view is being read. The request never
 * says which property: there is nothing here to tamper with.
 */
export async function AnalyticsPage<P extends PageId>({
  page,
  searchParams,
  View,
}: AnalyticsRouteProps & { page: P; View: ComponentType<{ data: PageData<P> }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  // Computed once and passed down, so every figure agrees on what day it is.
  const today = amsterdamToday();
  const demo = isDemoParam(params.demo);
  const period = parsePeriodParams(params, today);

  const data = await getPageData(page, {
    period,
    compare: parseCompareParam(params.compare),
    today,
    demo,
  });
  const meta = PAGES[page];

  const neverBooked = !data.hasAnyBookings;
  const header = (
    <PageHeader
      title={meta.title}
      description={meta.description}
      preset={period.preset}
      data={data as unknown as AnyPageData}
      exportDisabledReason={
        demo
          ? "Export is off in demo mode, so demo numbers cannot end up in your books."
          : neverBooked
            ? "Nothing to export until your first booking."
            : null
      }
    />
  );

  if (neverBooked) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first !== undefined) search.set(key, first);
    }
    search.set("demo", "1");
    return (
      <>
        {header}
        <GhostPage
          meta={meta}
          readiness={await loadReadiness(session.user.id, today)}
          demoHref={`${meta.path}${carryQuery(search)}`}
        />
      </>
    );
  }

  return (
    <>
      {demo ? <DemoBanner /> : null}
      {header}
      <View data={data} />
    </>
  );
}
