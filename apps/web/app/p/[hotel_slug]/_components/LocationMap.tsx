"use client";

import { Map, MapMarker, MarkerContent } from "@/components/ui/map";

export function LocationMap({ lon, lat }: { lon: number; lat: number }) {
  return (
    <Map center={[lon, lat]} zoom={14} interactive={false}>
      <MapMarker longitude={lon} latitude={lat}>
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
  );
}
