"use client";
import { HotelCard, type HotelCardData } from "@/components/search/HotelCard";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect } from "react";
import { getRandomBackgroundImage } from "@/lib/background";
import { useState } from "react";

const hotels: HotelCardData[] = [
  {
    id: 1,
    name: "Maison du Lac",
    distance: "1.2 km from centre",
    rating: 4.9,
    reviews: 312,
    price: 248,
    tags: ["Lake view", "Spa"],
    images: [
      "https://images.openbookings.co/luxury_hotel_room.webp",
      "https://images.openbookings.co/Test.png",
    ],
  },
  {
    id: 2,
    name: "Hotel de la Paix",
    distance: "1.2 km from centre",
    rating: 4.9,
    reviews: 312,
    price: 323,
    tags: ["Paris", "Luxury"],
    images: [
      "https://images.openbookings.co/luxury_hotel_room.webp",
      "https://images.openbookings.co/Test.png",
    ],
  },
  {
    id: 3,
    name: "Grand Hotel",
    distance: "1.2 km from centre",
    rating: 4.9,
    reviews: 312,
    price: 128,
    tags: ["Amsterdam", "Luxury"],
    images: [
      "https://images.openbookings.co/luxury_hotel_room.webp",
      "https://images.openbookings.co/Test.png",
    ],
  },
];

export default function DemoPage() {
  const [backgroundImage, setBackgroundImage] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);

  useEffect(() => {
    const CACHE_NAME = "openbookings-backgrounds";

    async function loadBackground() {
      let bg: { url: string; name: string };

      const stored = localStorage.getItem("openbookings_background");
      if (stored) {
        try {
          bg = JSON.parse(stored);
        } catch {
          bg = getRandomBackgroundImage();
          localStorage.setItem("openbookings_background", JSON.stringify(bg));
        }
      } else {
        bg = getRandomBackgroundImage();
        localStorage.setItem("openbookings_background", JSON.stringify(bg));
      }

      setBackgroundImage(bg);

      try {
        const cache = await caches.open(CACHE_NAME);
        let response = await cache.match(bg.url);
        if (!response) {
          await cache.add(bg.url);
          response = await cache.match(bg.url);
        }
        if (response) {
          const blob = await response.blob();
          setBackgroundSrc(URL.createObjectURL(blob));
          return;
        }
      } catch {
        // Cache API unavailable (e.g. private browsing on some browsers)
      }

      // Fallback to direct URL
      setBackgroundSrc(bg.url);
    }

    loadBackground();
  }, []);

  return (
    <div className="min-h-screen bg-foreground px-10 py-20 pb-[100px] font-sans">
      <div
        className="fixed inset-0 bg-black bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: backgroundSrc
            ? `url('${backgroundSrc}')`
            : undefined,
        }}
      >
        <div
          className="absolute inset-0 backdrop-blur-md"
          style={{
            background:
              "rgba(0,0,0,0.7)",
          }}
        ></div>
      </div>
      <div className="mx-auto max-w-[980px]">
        <Card className="mb-[60px] border-white/10 bg-card/40 shadow-md backdrop-blur-md">
          <CardHeader className="gap-1">
            <p className="font-sans text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
              24 properties found
            </p>
            <CardTitle className="font-serif text-4xl font-normal tracking-tight text-foreground">
              Discover Amsterdam
            </CardTitle>
            <CardDescription className="text-[13px] text-muted-foreground">
              28 Mar – 3 Apr · 2 guests
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 items-start">
          {hotels.map((hotel) => (
            <HotelCard key={hotel.id} hotel={hotel} />
          ))}
        </div>
      </div>
    </div>
  );
}
