import { Suspense } from "react";
import { AnalyticsSection, type AnalyticsPageProps } from "../_components/analytics-section";
import { SectionSkeleton } from "../_components/analytics-skeleton";
import { RevenueSectionView } from "../_components/revenue-section";

export default function RevenueSectionPage({ searchParams }: AnalyticsPageProps) {
  return (
    <Suspense fallback={<SectionSkeleton kpis={4} charts={4} />}>
      <AnalyticsSection searchParams={searchParams} View={RevenueSectionView} />
    </Suspense>
  );
}
