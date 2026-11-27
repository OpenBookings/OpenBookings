import type { Metadata } from "next";
import { getBackdrops } from "@openbookings/images/server";
import { JsonLd } from "@/components/JsonLd";
import { homepageJsonLd } from "@/lib/seo/structured-data";
import { HomeClient } from "./_components/HomeClient";

// Same for every visitor, so Cloudflare can cache it. Matches the backdrop
// manifest's own refresh time.
export const revalidate = 3600;

// Set here, not in the root layout: a canonical there would be inherited by
// every page that does not set its own, pointing them all at the homepage.
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  return (
    <>
      <JsonLd data={homepageJsonLd()} />
      <HomeClient backdrops={await getBackdrops()} />
    </>
  );
}
