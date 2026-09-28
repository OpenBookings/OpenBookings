import { Suspense } from "react";
import { AnalyticsSection, type AnalyticsPageProps } from "../_components/analytics-section";
import { SectionSkeleton } from "../_components/analytics-skeleton";
import { SellThroughSectionView } from "../_components/sell-through-section";

export default function SellThroughSectionPage({ searchParams }: AnalyticsPageProps) {
  return (
    <Suspense fallback={<SectionSkeleton kpis={2} charts={2} fullWidth={1} />}>
      <AnalyticsSection searchParams={searchParams} View={SellThroughSectionView} />
    </Suspense>
  );
}
