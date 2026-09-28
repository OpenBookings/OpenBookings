import { Suspense } from "react";
import { AnalyticsSection, type AnalyticsPageProps } from "../_components/analytics-section";
import { SectionSkeleton } from "../_components/analytics-skeleton";
import { PricingSectionView } from "../_components/pricing-section";

export default function PricingSectionPage({ searchParams }: AnalyticsPageProps) {
  return (
    <Suspense fallback={<SectionSkeleton kpis={1} charts={2} />}>
      <AnalyticsSection searchParams={searchParams} View={PricingSectionView} />
    </Suspense>
  );
}
