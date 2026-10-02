import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { RevenuePageView } from "../_components/pages/revenue-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="revenue" searchParams={searchParams} View={RevenuePageView} />;
}
