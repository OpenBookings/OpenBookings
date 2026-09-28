import { Suspense } from "react";
import { AnalyticsSection, type AnalyticsPageProps } from "../_components/analytics-section";
import { SectionSkeleton } from "../_components/analytics-skeleton";
import { GuestsSectionView } from "../_components/guests-section";

export default function GuestsSectionPage({ searchParams }: AnalyticsPageProps) {
  return (
    <Suspense fallback={<SectionSkeleton kpis={2} charts={0} fullWidth={1} />}>
      <AnalyticsSection searchParams={searchParams} View={GuestsSectionView} />
    </Suspense>
  );
}
