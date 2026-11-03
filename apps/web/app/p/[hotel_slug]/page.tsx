import { notFound } from "next/navigation";
import { getHotelPage } from "@/lib/hotel-page-data";
import { withAllInPrices, withCancellationTerms } from "@/lib/listing-prices";
import type { DbAmenityCategory } from "./_components/constants";

import { NavWrapper }       from "./_components/NavWrapper";
import { ScrollSpy }        from "./_components/ScrollSpy";
import { HeroSection }      from "./_components/HeroSection";
import { GalleryBar }       from "./_components/GalleryBar";
import { OverviewSection }  from "./_components/OverviewSection";
import { RoomsSection }     from "./_components/RoomsCarousel";
import { PoliciesSection }  from "./_components/PoliciesSection";
import { LocationSection }  from "./_components/LocationSection";
import { FootnoteSection }  from "./_components/FootnoteSection";

// The page is the same for every visitor (the nav loads the session in the
// browser), so it is rendered once and cached, here and at Cloudflare.
// Host edits refresh it straight away through /api/revalidate; this is the
// backstop. Prices are "for today", so a page cached just before midnight can
// show yesterday's rate for up to five minutes. Checkout prices live.
export const revalidate = 300;

// No slugs are rendered at build time (the build has no database). An empty
// list still makes the route cacheable: each slug is rendered on its first
// request and cached from then on.
export function generateStaticParams() {
  return [];
}

export default async function HotelPage({
  params,
}: {
  params: Promise<{ hotel_slug: string }>;
}) {
  const { hotel_slug } = await params;
  const slug = hotel_slug.toLowerCase();

  const page = await getHotelPage(slug);
  if (!page) notFound();

  const { hotel, amenities: rawAmenities } = page;
  // All-in per night, tourist tax included, priced for today.
  // Non-refundable rates that are not at least 10% cheaper are left out.
  const rooms = withCancellationTerms(
    withAllInPrices(page.rooms, page.touristTaxRules ?? [], new Date().toISOString().slice(0, 10)),
    hotel.cancellation_tier ?? "standard",
  );

  const gallery = hotel.gallery_images ?? [];

  const amenityCategories: DbAmenityCategory[] = [];
  for (const a of rawAmenities) {
    let cat = amenityCategories.find((c) => c.label === a.category);
    if (!cat) {
      cat = { label: a.category, items: [] };
      amenityCategories.push(cat);
    }
    cat.items.push({ label: a.label, icon: a.icon });
  }

  return (
    <div className="bg-[#0a0a0a] text-white">
      <NavWrapper />
      <ScrollSpy />

      <HeroSection hotel={hotel} />

      {gallery.length > 0 && (
        <div className="py-4 bg-[#0a0a0a]">
          <GalleryBar images={gallery} />
        </div>
      )}

      <OverviewSection hotel={hotel} amenityCategories={amenityCategories} />
      <RoomsSection rooms={rooms} ratesConfirmed={hotel.rates_confirmed === true} />
      <PoliciesSection
        hotel={hotel}
        hasNonRefundable={rooms.some((room) => room.rate_plans.some((plan) => !plan.is_refundable))}
      />
      <LocationSection hotel={hotel} />
      <FootnoteSection hotel={hotel} />

      <footer className="bg-[#0a0a0a] border-t border-white/6 px-4 sm:px-8 md:px-24 py-10 max-w-7xl mx-auto flex items-center justify-between text-white/30 text-sm">
        <span>{hotel.name}</span>
        <span>© {new Date().getFullYear()} OpenBookings</span>
      </footer>
    </div>
  );
}
