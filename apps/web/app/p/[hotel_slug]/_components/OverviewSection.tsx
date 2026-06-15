import type { HotelPageData } from "@/app/api/query/pr/route";
import type { DbAmenityCategory } from "./constants";
import { AmenitiesSection } from "./AmenitiesSection";

export function OverviewSection({ hotel, amenityCategories }: { hotel: HotelPageData; amenityCategories: DbAmenityCategory[] }) {
  return (
    <section id="overview" className="bg-[#0a0a0a]">
      <div className="px-4 sm:px-8 md:px-24 py-16 sm:py-20 max-w-6xl mx-auto">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-6 text-center">Overview</p>
        <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl leading-tight mb-16 text-center whitespace-nowrap">
          Where stillness meets the sea
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-12 lg:gap-16 items-start mb-14">
          {/* Review score */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-7">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="font-serif text-3xl text-white">8.9</span>
                <div className="flex flex-col items-start">
                  <span className="text-sm text-white/65">Excellent</span>
                  <span className="text-xs text-white/35">324 reviews</span>
                </div>
              </div>
            </div>

            <div className="border-t border-white/6" />

            <div className="flex flex-col gap-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30">Recent Review</p>
              <blockquote className="text-sm text-white/70 leading-relaxed italic">
                &ldquo;The most breathtaking sunsets I have ever experienced. Every detail was
                considered — from the thread count to the scent of the towels. We will return.&rdquo;
              </blockquote>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/30">— Maria K., May 2025</span>
                <span className="flex items-center gap-1 bg-blue-500/12 text-blue-400 text-sm font-semibold rounded-lg px-2.5 py-1 border border-blue-500/15">
                  9.4
                </span>
              </div>
            </div>
          </div>

          {/* Short intro */}
          <div className="flex flex-col gap-8 text-white/75 text-lg leading-relaxed pt-2">
            <p>
              Nestled along a secluded coastline, {hotel.name} is a sanctuary built for those who
              seek beauty without compromise. Every surface, every view, every moment has been
              considered with quiet precision. Guests arrive to discover that luxury here is not
              loud — it is the sound of water at dusk, a perfectly rested morning, and a team that
              anticipates before you ask. This is your home for as long as you choose to stay.
            </p>
          </div>
        </div>

        <div className="border-t border-white/8 mb-8" />

        <AmenitiesSection hotelName={hotel.name} amenityCategories={amenityCategories} />
      </div>
    </section>
  );
}
