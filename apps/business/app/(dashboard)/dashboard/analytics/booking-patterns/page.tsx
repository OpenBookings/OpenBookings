import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { BookingPatternsPageView } from "../_components/pages/booking-patterns-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="booking-patterns" searchParams={searchParams} View={BookingPatternsPageView} />;
}
