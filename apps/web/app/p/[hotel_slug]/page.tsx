import { notFound } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { getPool } from "@openbookings/db";
import { infantsPayTouristTax, isValidTimeZone } from "@openbookings/pricing";
import { priceTonight, type TonightPrice } from "@/lib/booking/quote";
import { todayInZone } from "@/lib/booking/stay-input";
import { getHotelPage } from "@/lib/hotel-page-data";
import { withAllInPrices, withCancellationTerms } from "@/lib/listing-prices";
import { getPropertyReviews } from "@/lib/property-reviews";
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
// backstop. Prices are tonight's at the property, so a page cached just before
// its midnight can show yesterday's for up to five minutes. Checkout prices live.
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
  // Cached for a day on its own (lib/property-reviews.ts); never throws.
  const reviews = await getPropertyReviews(hotel.id);
  // All-in per night, tourist tax included: tonight at the property, priced
  // as the stay quote prices it, or the base rate as "from" where tonight
  // can't be booked. Non-refundable rates that are not at least 10% cheaper
  // are left out.
  const now = new Date();
  // Without a usable zone (pages cached before it was stored): the EU's
  // earliest today, as search uses.
  const timeZone = hotel.timezone && isValidTimeZone(hotel.timezone) ? hotel.timezone : "Atlantic/Azores";
  const today = todayInZone(timeZone, now);
  const tonight = await priceTonight(getPool(), { id: hotel.id, timezone: timeZone }, now).catch(
    (err): Record<string, TonightPrice> => {
      // The page still renders, at base rates shown as "from".
      Sentry.captureException(err, { tags: { area: "property-page", phase: "tonight-prices" } });
      return {};
    },
  );
  const rooms = withCancellationTerms(
    withAllInPrices(page.rooms, page.touristTaxRules ?? [], today, tonight),
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

      <OverviewSection hotel={hotel} amenityCategories={amenityCategories} reviews={reviews} />
      <RoomsSection
        rooms={rooms}
        ratesConfirmed={hotel.rates_confirmed === true}
        childrenWelcome={hotel.children_welcome ?? true}
        slug={slug}
        propertyId={hotel.id}
        // The stay quote judges "in the past" itself.
        timeZone={timeZone}
      />
      <PoliciesSection
        hotel={hotel}
        hasNonRefundable={rooms.some((room) => room.rate_plans.some((plan) => !plan.is_refundable))}
        infantsPayTouristTax={infantsPayTouristTax(page.touristTaxRules ?? [], today)}
        extras={{
          cots: rooms.some((room) => (room.cots_max ?? 0) > 0),
          extraBeds: rooms.some((room) => (room.extra_beds_max ?? 0) > 0),
        }}
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
