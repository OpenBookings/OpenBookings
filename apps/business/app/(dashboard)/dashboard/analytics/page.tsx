import { redirect } from "next/navigation";
import type { AnalyticsPageProps } from "./_components/analytics-section";

/**
 * The tab itself is a dead end: the sidebar entry only expands its sub-items, so
 * nothing in the app links here. This exists for the old bookmark and the pasted
 * link, and it carries whatever period, property or demo flag came with them
 * rather than dropping the host on an unfiltered page.
 */
export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const entries = Object.entries(await searchParams).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const query = new URLSearchParams(entries).toString();
  redirect(`/dashboard/analytics/revenue${query ? `?${query}` : ""}`);
}
