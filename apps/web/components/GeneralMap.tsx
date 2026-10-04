"use client";

import { Card } from "./ui/card";
import { Map, MapControls } from "./ui/map";

export default function GeneralMap() {
  return (
    <Card className="h-full w-full p-0 overflow-hidden">
      <Map center={[-74.006, 40.7128]} zoom={11}>
        <MapControls />
      </Map>
    </Card>
  );
}
