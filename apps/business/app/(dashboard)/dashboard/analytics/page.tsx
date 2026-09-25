import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/dashboard/site-header";
import { getServerSession } from "@/lib/auth";
import { getAnalytics, listProperties } from "@/lib/analytics/get-analytics";
import { parsePeriodParams } from "@/lib/analytics/period";
import type { IsoDate } from "@/lib/analytics/types";
import { AnalyticsFilters } from "./_components/analytics-filters";
import { AnalyticsSkeleton } from "./_components/analytics-skeleton";
import { BookingsSectionView } from "./_components/bookings-section";
import { GuestsSectionView } from "./_components/guests-section";
import { PricingSectionView } from "./_components/pricing-section";
import { RevenueSectionView } from "./_components/revenue-section";
import { SellThroughSectionView } from "./_components/sell-through-section";
import { DemoBanner, NewPropertyAlert } from "./_components/states";

interface PageProps {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    property?: string;
    demo?: string;
    fail?: string;
  }>;
}

export default function AnalyticsPage({ searchParams }: PageProps) {
  return (
    <>
      <SiteHeader title="Analytics" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            <Suspense fallback={<AnalyticsSkeleton />}>
              <AnalyticsContent searchParams={searchParams} />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}

async function AnalyticsContent({ searchParams }: PageProps) {
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

  if (!data.hasAnyBookings) {
    return (
      <>
        {demo ? <DemoBanner /> : null}
        {properties.length > 1 ? (
          <AnalyticsFilters
            preset={period.preset}
            range={data.range}
            properties={properties}
            selectedPropertyId={data.property.id}
          />
        ) : null}
        {/* Sections hidden: there is nothing to arrange yet, and a grid of
            em dashes is not an improvement on a sentence. */}
        <NewPropertyAlert showDemoLink={!demo} />
      </>
    );
  }

  return (
    <>
      {demo ? <DemoBanner /> : null}
      <AnalyticsFilters
        preset={period.preset}
        range={data.range}
        properties={properties}
        selectedPropertyId={data.property.id}
      />
      <RevenueSectionView data={data} />
      <SellThroughSectionView data={data} />
      <BookingsSectionView data={data} />
      <PricingSectionView data={data} />
      <GuestsSectionView data={data} />
    </>
  );
}
