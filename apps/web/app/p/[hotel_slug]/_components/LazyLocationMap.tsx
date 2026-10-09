"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// maplibre-gl is several hundred kilobytes and the map is the last section on
// the page, so neither the code nor the tiles are fetched until a guest
// scrolls to within a viewport of it.
const LocationMap = dynamic(() => import("./LocationMap").then((m) => m.LocationMap), { ssr: false });

export function LazyLocationMap({ lon, lat }: { lon: number; lat: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // Without IntersectionObserver there is no way to wait, so load at once.
  const [near, setNear] = useState(() => typeof window !== "undefined" && typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="size-full bg-white/4">
      {near && <LocationMap lon={lon} lat={lat} />}
    </div>
  );
}
