"use client";

import { Card } from "./ui/card";
import { Map, MapControls } from "./ui/map";

export default function GeneralMap() {
  const styleUrl = `https://api.maptiler.com/maps/${process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID}/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_API_KEY}`;
  return (
    <Card className="h-full w-full p-0 overflow-hidden">
      <Map 
        center={[-74.006, 40.7128]} 
        zoom={11}
        styles={{
          dark: styleUrl,
          light: styleUrl // Force dark mode for both themes
        }}
      >
        <MapControls />
      </Map>
    </Card>
  );
}