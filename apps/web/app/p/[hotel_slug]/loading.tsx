import { Skeleton } from "@/components/ui/skeleton";

function HeroSkeleton() {
  return (
    <section className="relative h-screen overflow-hidden bg-[#0a0a0a]">
      {/* Background shimmer */}
      <Skeleton className="absolute inset-0 rounded-none bg-white/4" />

      {/* Subtle gradient to ground the bottom content */}
      <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

      {/* Bottom row: title left, CTA right */}
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-4 sm:px-8 md:px-14 pb-14 sm:pb-16">
        {/* Title + subtitle */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 sm:h-20 md:h-24 w-[420px] max-w-[60vw] rounded-xl bg-white/10" />
          <Skeleton className="h-8 sm:h-10 w-64 max-w-[45vw] rounded-lg bg-white/7 ml-3" />
        </div>

        {/* Book Now + scroll hint */}
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-[60px] w-44 rounded-xl bg-white/10" />
          <div className="flex flex-col items-center gap-1.5">
            <Skeleton className="h-3.5 w-20 rounded bg-white/6" />
            <Skeleton className="h-5 w-8 rounded bg-white/6" />
          </div>
        </div>
      </div>
    </section>
  );
}

function GalleryBarSkeleton() {
  return (
    <div className="py-4 bg-[#0a0a0a]">
      <div className="flex gap-2 overflow-hidden" style={{ height: 130 }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-full shrink-0 rounded-lg bg-white/6"
            style={{ width: 195 }}
          />
        ))}
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <section className="bg-[#0a0a0a] px-4 sm:px-8 md:px-24 py-16 sm:py-20 max-w-6xl mx-auto">
      {/* Label + heading */}
      <Skeleton className="h-3 w-16 mx-auto mb-6 rounded bg-white/6" />
      <Skeleton className="h-12 sm:h-14 w-80 mx-auto mb-16 rounded-xl bg-white/7" />

      {/* Review card + intro text */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-12 lg:gap-16 mb-14">
        <Skeleton className="h-60 rounded-2xl bg-white/4" />
        <div className="flex flex-col gap-4 pt-2">
          <Skeleton className="h-4 w-full rounded bg-white/5" />
          <Skeleton className="h-4 w-[95%] rounded bg-white/5" />
          <Skeleton className="h-4 w-[88%] rounded bg-white/5" />
          <Skeleton className="h-4 w-[92%] rounded bg-white/5" />
          <Skeleton className="h-4 w-[75%] rounded bg-white/5" />
        </div>
      </div>

      {/* Amenity pills */}
      <div className="border-t border-white/8 mb-8" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 2 }).map((_, ri) => (
          <div key={ri} className="flex gap-3">
            {Array.from({ length: 5 }).map((_, ci) => (
              <Skeleton key={ci} className="flex-1 h-14 rounded-xl bg-white/4" />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function HotelPageLoading() {
  return (
    <div className="bg-[#0a0a0a] text-white">
      <HeroSkeleton />
      <GalleryBarSkeleton />
      <OverviewSkeleton />
    </div>
  );
}
