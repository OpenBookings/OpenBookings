import { Navigation } from "lucide-react";
import { LazyLocationMap } from "./LazyLocationMap";
import type { HotelPageData } from "@/app/api/query/pr/route";
import { getIcon } from "./icons";

export function LocationSection({ hotel }: { hotel: HotelPageData }) {
  const hasCoords = typeof hotel.lon === "number" && typeof hotel.lat === "number";
  const highlights = hotel.highlights ?? [];

  return (
    <section id="location" className="bg-[#111111] border-t border-white/6 py-28 sm:py-36">
      <div className="px-4 sm:px-8 md:px-16 max-w-7xl mx-auto">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-6 text-center">Find us</p>
        <h2 className="font-serif text-4xl sm:text-5xl mb-10 text-center">Location</h2>

        <div
          className={`grid grid-cols-1 gap-10 items-stretch md:h-80 overflow-hidden ${
            highlights.length > 0 ? "md:grid-cols-3" : "md:grid-cols-2"
          }`}
        >
          {/* About + address */}
          <div className="flex flex-col text-white/75 text-lg leading-relaxed">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-4">About</p>
            <p>{hotel.location_about}</p>
            <div className="mt-auto pt-8 flex items-center gap-4">
              <button
                type="button"
                aria-label="Get directions"
                className="flex size-10 items-center justify-center rounded-full border border-white/12 bg-white/6 text-white/40 hover:bg-white/12 hover:text-white/80 transition-colors"
              >
                <Navigation className="size-4" strokeWidth={1.6} />
              </button>
              <div className="space-y-1 text-white/60 text-sm">
                <p>{hotel.address_line_1}</p>
                {hotel.address_line_2 && <p>{hotel.address_line_2}</p>}
                <p>{[hotel.postal_code, hotel.city].filter(Boolean).join(" ")}</p>
              </div>
            </div>
          </div>

          {/* Map */}
          <div className="h-full min-h-64 rounded-2xl overflow-hidden border border-white/8">
            {hasCoords && (
              <div className="relative w-full h-full pointer-events-none select-none">
                <LazyLocationMap lon={hotel.lon} lat={hotel.lat} />
              </div>
            )}
          </div>

          {/* Nearby highlights. A host who added none gets a two-column grid,
              not an empty third column under a heading. */}
          {highlights.length > 0 && (
            <div className="flex flex-col min-h-0">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-4">Nearby</p>
              <div className="flex-1 overflow-y-auto space-y-px [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
                {highlights.map(({ label, icon, distance }) => {
                  const Icon = getIcon(icon);
                  return (
                    <div
                      key={label}
                      className="flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-white/4 transition-colors group"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/6 text-white/40 group-hover:text-white/60 transition-colors">
                        <Icon className="size-3.5" strokeWidth={1.6} />
                      </span>
                      <span className="flex-1 text-sm text-white/80 group-hover:text-white transition-colors truncate">
                        {label}
                      </span>
                      <span className="text-xs text-white/30 shrink-0 tabular-nums">{distance}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
