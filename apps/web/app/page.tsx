import { getBackdrops } from "@openbookings/images/server";
import { HomeClient } from "./_components/HomeClient";

// Same for every visitor, so Cloudflare can cache it. Matches the backdrop
// manifest's own refresh time.
export const revalidate = 3600;

export default async function Home() {
  return <HomeClient backdrops={await getBackdrops()} />;
}
