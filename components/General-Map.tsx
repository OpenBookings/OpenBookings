"use client";

import { Card } from "./ui/card";
import { Map, MapControls } from "./ui/map";

export default function GeneralMap() {
  const darkStyle = "https://api.maptiler.com/maps/019b9381-cf26-7d5c-b3b3-6e23e4de4adc/style.json?key=nctBaf1Bkt1S4U77nQGP";
  
  return (
    <Card className="h-full w-full p-0 overflow-hidden">
      <Map 
        center={[-74.006, 40.7128]} 
        zoom={11}
        styles={{
          dark: darkStyle,
          light: darkStyle // Force dark mode for both themes
        }}
      >
        <MapControls />
      </Map>
    </Card>
  );
}