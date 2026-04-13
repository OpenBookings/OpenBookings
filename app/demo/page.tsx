"use client";
import { HotelCard, type HotelCardData } from "@/components/search/HotelCard";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect } from "react";
import { getRandomBackgroundImage } from "@/lib/background";
import { useState } from "react";

const hotels: HotelCardData[] = [
  {
    id: "3104936b-2dd8-4de0-9a86-1aa5dd8f2b53",
    name: "Jumeirah Capri Palace",
    distance: "1.2 Kilometers to City Center",
    rating: 8.0,
    reviews: 324,
    price: 248,
    tags: ["Lake View", "Free Wi-Fi", "Incl. Breakfast", "Free Cancellation"],
    images: [
      "Jumeirah.avif",
      "Jumeirah-1.avif",
      "Jumeirah-2.avif"
    ],
    description: {
      "type": "Suite",
      "bed": "1 King Bed",
      "size": "100 m²",
    },
    availability: 2,
  },
  {
    id: "3104936b-2dd8-4de0-9a86-1aa5dd8f2b53",
    name: "Hotel de la Paix",
    distance: "1.2 Kilometers to City Center",
    rating: 7.8,
    reviews: 654,
    price: 323,
    tags: ["Paris", "Luxury", "Incl. Dinner"],
    images: [
      "Jumeirah-1.avif",
    ],
    description: {
      "type": "Deluxe",
      "bed": "1 King Bed",
      "size": "100 m²",
    },
    availability: 10,
  },
  {
    id: "3104936b-2dd8-4de0-9a86-1aa5dd8f2b53",
    name: "Amsterdam Grand Hotel",
    distance: "1.2 Kilometers to City Center",
    rating: 9.3,
    reviews: 987,
    price: 128,
    tags: ["Amsterdam", "Weed", "Butler"],
    images: [
      "Jumeirah-2.avif",
    ],
    description: {
      "type": "Standard",
      "bed": "1 King Bed",
      "size": "100 m²",
    },
    availability: 10,
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
        <Card className="mb-[10px] border-white/10 bg-card/40 shadow-md backdrop-blur-md">
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
            <CardDescription className="text-[13px] text-green-700/70 font-medium">
            <span className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-info-circle" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
              </svg>
              <span>All rates include tax</span>
            </span>
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
