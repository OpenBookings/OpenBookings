import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { PricingPageView } from "../_components/pages/pricing-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="pricing" searchParams={searchParams} View={PricingPageView} />;
}
