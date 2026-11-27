import type { Metadata } from "next";
import { getBackdrops } from "@openbookings/images/server";
import { SearchClient } from "./_components/SearchClient";

// The shell is the same for every visitor (results load in the browser from
// /api/query), so Cloudflare can cache it.
export const revalidate = 3600;

// Kept out of search results, with or without a query: the results load in
// the browser, so there is nothing here for a crawler to index, and every
// destination and date combination would be another thin URL. `follow` still
// lets crawlers reach the listings linked from it.
export const metadata: Metadata = {
  title: "Search | OpenBookings",
  robots: { index: false, follow: true },
  alternates: { canonical: "/search" },
};

export default async function SearchPage() {
  return <SearchClient backdrops={await getBackdrops()} />;
}
