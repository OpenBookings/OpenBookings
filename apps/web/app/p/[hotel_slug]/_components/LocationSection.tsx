import { Navigation } from "lucide-react";
import { Map, MapMarker, MarkerContent } from "@/components/ui/map";
import type { HotelPageData } from "@/app/api/query/pr/route";
import { HIGHLIGHTS } from "./constants";

export function LocationSection({ hotel }: { hotel: HotelPageData }) {
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
  const MTStyleKey = process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID;
  const hasCoords = typeof hotel.lon === "number" && typeof hotel.lat === "number";

  return (
    <section id="location" className="bg-[#111111] border-t border-white/6 py-28 sm:py-36">
      <div className="px-4 sm:px-8 md:px-16 max-w-7xl mx-auto">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-6 text-center">Find us</p>
        <h2 className="font-serif text-4xl sm:text-5xl mb-10 text-center">Location</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 items-stretch md:h-80 overflow-hidden">
          {/* About + address */}
          <div className="flex flex-col text-white/75 text-lg leading-relaxed">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-4">About</p>
            <p>
              Situated just 20 minutes from the international airport, yet a world apart from the
              ordinary. Our address is one of the region&apos;s best-kept secrets.
            </p>
            <div className="mt-auto pt-8 flex items-center gap-4">
              <button
                type="button"
                aria-label="Get directions"
                className="flex size-10 items-center justify-center rounded-full border border-white/12 bg-white/6 text-white/40 hover:bg-white/12 hover:text-white/80 transition-colors"
              >
                <Navigation className="size-4" strokeWidth={1.6} />
              </button>
              <div className="space-y-1 text-white/60 text-sm">
                <p>Via della Quiete 1</p>
                <p>57037 Portoferraio, Italy</p>
              </div>
            </div>
          </div>

          {/* Map */}
          <div className="h-full min-h-64 rounded-2xl overflow-hidden border border-white/8">
            {hasCoords && (
              <div className="relative w-full h-full pointer-events-none select-none">
                <Map
                  styles={
                    maptilerKey && MTStyleKey
                      ? {
                          dark: `https://api.maptiler.com/maps/${MTStyleKey}/style.json?key=${maptilerKey}`,
                          light: `https://api.maptiler.com/maps/${MTStyleKey}/style.json?key=${maptilerKey}`,
                        }
                      : undefined
                  }
                  center={[hotel.lon, hotel.lat]}
                  zoom={14}
                  attributionControl={false}
                  interactive={false}
                >
                  <MapMarker longitude={hotel.lon} latitude={hotel.lat}>
                    <MarkerContent>
                      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 24 30" fill="none">
                        <path
                          d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 21 9 21s9-14.25 9-21c0-4.97-4.03-9-9-9z"
                          fill="oklch(62% 0.21 268)"
                        />
                        <circle cx="12" cy="9" r="3.5" fill="white" />
                      </svg>
                    </MarkerContent>
                  </MapMarker>
                </Map>
              </div>
            )}
          </div>

          {/* Nearby highlights */}
          <div className="flex flex-col min-h-0">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-4">Nearby</p>
            <div className="flex-1 overflow-y-auto space-y-px [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
              {HIGHLIGHTS.map(({ icon: Icon, label, distance }) => (
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
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
