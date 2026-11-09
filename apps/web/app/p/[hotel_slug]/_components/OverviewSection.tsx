import type { HotelPageData } from "@/app/api/query/pr/route";
import type { DbAmenityCategory } from "./constants";
import type { PropertyReviews } from "@openbookings/db/reviews";
import { AmenitiesSection } from "./AmenitiesSection";
import { ReviewsCard } from "./ReviewsCard";

export function OverviewSection({
  hotel,
  amenityCategories,
  reviews,
}: {
  hotel: HotelPageData;
  amenityCategories: DbAmenityCategory[];
  /** Null when they couldn't be loaded. */
  reviews: PropertyReviews | null;
}) {
  return (
    <section id="overview" className="bg-[#0a0a0a]">
      <div className="px-4 sm:px-8 md:px-24 py-16 sm:py-20 max-w-6xl mx-auto">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-6 text-center">Overview</p>
        <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl leading-tight mb-16 text-center">
          {hotel.overview_headline}
        </h2>

        {reviews ? (
          <div className="grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-12 lg:gap-16 items-start mb-14">
            <ReviewsCard data={reviews} />
            <div className="flex flex-col gap-8 text-white/75 text-lg leading-relaxed pt-2">
              <p>{hotel.overview_description}</p>
            </div>
          </div>
        ) : (
          // Reviews couldn't be loaded: the intro on its own rather than an error.
          <div className="max-w-3xl mx-auto mb-14 text-white/75 text-lg leading-relaxed">
            <p>{hotel.overview_description}</p>
          </div>
        )}

        <div className="border-t border-white/8 mb-8" />

        <AmenitiesSection hotelName={hotel.name} amenityCategories={amenityCategories} />
      </div>
    </section>
  );
}
