import { Suspense } from "react";
import { AnalyticsSection, type AnalyticsPageProps } from "../_components/analytics-section";
import { SectionSkeleton } from "../_components/analytics-skeleton";
import { BookingsSectionView } from "../_components/bookings-section";

export default function BookingsSectionPage({ searchParams }: AnalyticsPageProps) {
  return (
    <Suspense fallback={<SectionSkeleton kpis={3} charts={2} />}>
      <AnalyticsSection searchParams={searchParams} View={BookingsSectionView} />
    </Suspense>
  );
}
