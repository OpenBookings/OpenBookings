import { redirect } from "next/navigation";
import { carryQuery } from "@/lib/analytics/pages";

type RawParams = Record<string, string | string[] | undefined>;

/**
 * Nothing links here: the sidebar entry only expands its sub-items. This exists
 * for the old bookmark and the pasted link, and carries the filters with it.
 */
export default async function AnalyticsIndex({ searchParams }: { searchParams: Promise<RawParams> }) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) search.set(key, first);
  }
  redirect(`/dashboard/analytics/revenue${carryQuery(search)}`);
}
