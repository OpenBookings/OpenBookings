import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { getAnalytics, listProperties } from "@/lib/analytics/get-analytics";
import { parsePeriodParams } from "@/lib/analytics/period";
import type { AnalyticsData, IsoDate } from "@/lib/analytics/types";
import { getServerSession } from "@/lib/auth";
import { AnalyticsFilters } from "./analytics-filters";
import { DemoBanner, NewPropertyAlert } from "./states";

export interface AnalyticsSearchParams {
  period?: string;
  from?: string;
  to?: string;
  property?: string;
  demo?: string;
  fail?: string;
}

/** Every section page takes the same props, because every one reads the same filters. */
export interface AnalyticsPageProps {
  searchParams: Promise<AnalyticsSearchParams>;
}

/**
 * Everything the five section pages share: the session check, the period and
 * property the host chose, one getAnalytics() call, and the banner, alert and
 * filter bar that frame whichever section is being read. A page supplies only
 * its own view, so none of this is written five times.
 *
 * `View` is a component rather than a render prop: this and the pages that use
 * it are server components, so it is called during the server render and never
 * has to cross the client boundary that the section tree's render props do.
 */
export async function AnalyticsSection({
  searchParams,
  View,
}: AnalyticsPageProps & { View: ComponentType<{ data: AnalyticsData }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  // Passed in rather than read inside, so every derivation agrees on what day
  // it is and nothing reaches for a bare `new Date()`.
  const today: IsoDate = new Date().toISOString().slice(0, 10);

  // Opt-in, never a fallback. A host must not be shown invented revenue because
  // the real query has not been written yet.
  const demo = params.demo === "1";
  const period = parsePeriodParams(params, today);
  const properties = listProperties(demo);

  const data = await getAnalytics({
    propertyId: params.property,
    period,
    today,
    demo,
    fail: params.fail,
  });

  const filters = (
    <AnalyticsFilters
      preset={period.preset}
      range={data.range}
      properties={properties}
      selectedPropertyId={data.property.id}
    />
  );

  if (!data.hasAnyBookings) {
    return (
      <>
        {demo ? <DemoBanner /> : null}
        {properties.length > 1 ? filters : null}
        {/* The section is hidden: there is nothing to arrange yet, and a grid of
            em dashes is not an improvement on a sentence. */}
        <NewPropertyAlert showDemoLink={!demo} />
      </>
    );
  }

  return (
    <>
      {demo ? <DemoBanner /> : null}
      {filters}
      <View data={data} />
    </>
  );
}
