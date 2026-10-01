import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { OccupancyPageView } from "../_components/pages/occupancy-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="occupancy" searchParams={searchParams} View={OccupancyPageView} />;
}
