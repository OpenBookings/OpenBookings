import { getBackdrops } from "@openbookings/images/server";
import { SearchClient } from "./_components/SearchClient";

// The shell is the same for every visitor (results load in the browser from
// /api/query), so Cloudflare can cache it.
export const revalidate = 3600;

export default async function SearchPage() {
  return <SearchClient backdrops={await getBackdrops()} />;
}
