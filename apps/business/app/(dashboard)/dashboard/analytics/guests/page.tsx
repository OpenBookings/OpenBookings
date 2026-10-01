import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { GuestsPageView } from "../_components/pages/guests-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="guests" searchParams={searchParams} View={GuestsPageView} />;
}
