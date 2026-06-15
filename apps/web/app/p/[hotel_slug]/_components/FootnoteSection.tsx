import type { HotelPageData } from "@/app/api/query/pr/route";

export function FootnoteSection({ hotel }: { hotel: HotelPageData }) {
  return (
    <section id="book" className="bg-[#0a0a0a] border-t border-white/6">
      <div className="px-4 sm:px-8 md:px-20 py-28 max-w-7xl mx-auto">
        {/* Logos */}
        <div className="flex items-center justify-center gap-8 mb-8">
          {hotel.logo_image_url ? (
            <img
              src={hotel.logo_image_url}
              alt={`${hotel.name} logo`}
              className="h-auto w-28 object-contain"
            />
          ) : (
            <span className="text-white/70 text-base font-medium tracking-wide">{hotel.name}</span>
          )}
          <span className="flex items-center justify-center h-14 text-white/20 text-3xl font-thin select-none leading-none">
            ×
          </span>
          <img
            src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
            alt="OpenBookings"
            className="h-auto w-28 object-contain"
          />
        </div>

        <div className="max-w-xl mx-auto mt-10 pb-10 border-t border-white/6" />

        {/* CTA */}
        <div className="text-center">
          <h2 className="font-serif text-5xl sm:text-6xl md:text-7xl mb-6">Ready to arrive?</h2>
          <p className="text-white/70 text-xl mb-12 max-w-lg mx-auto">
            Reserve your stay at {hotel.name} and let us take care of the rest.
          </p>
          <button
            type="button"
            className="bg-white text-black font-semibold text-lg px-10 py-4 rounded-xl hover:bg-white/90 transition-colors"
          >
            Book Now
          </button>
        </div>
      </div>
    </section>
  );
}
