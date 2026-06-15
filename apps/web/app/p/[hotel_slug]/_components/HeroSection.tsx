import type { HotelPageData } from "@/app/api/query/pr/route";

export function HeroSection({ hotel }: { hotel: HotelPageData }) {
  return (
    <section id="hero" className="relative h-screen overflow-hidden bg-[#0a0a0a]">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${hotel.hero_image_url}')` }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 20%, rgba(0,0,0,0.2) 45%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.3) 100%)",
          }}
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-4 sm:px-8 md:px-14 pb-14 sm:pb-16">
        <div style={{ textShadow: "0 2px 24px rgba(0,0,0,0.85), 0 1px 6px rgba(0,0,0,0.6)" }}>
          <h1 className="font-serif text-6xl sm:text-7xl md:text-8xl tracking-tight mb-2 select-none">
            {hotel.name}
          </h1>
          <p className="text-3xl sm:text-4xl text-white/80 font-semibold select-none pl-3">
            {hotel.subtitle}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            className="min-w-44 max-w-xs w-full bg-black/30 backdrop-blur-2xl rounded-xl border border-white/20 shadow-2xl px-6 py-4 flex items-center justify-center hover:bg-black/50 transition-colors"
          >
            <span className="text-xl sm:text-2xl font-serif whitespace-nowrap text-white">
              Book Now
            </span>
          </button>

          <div className="flex flex-col items-center">
            <span className="text-base text-white/60 select-none">Scroll for more</span>
            <svg
              className="w-8 h-5 text-white/60"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 48 20"
              aria-hidden="true"
            >
              <path d="M8 6l16 8 16-8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
