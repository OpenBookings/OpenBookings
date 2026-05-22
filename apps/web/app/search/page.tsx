"use client";
import { Nav } from "@/components/nav";
import { HotelCard, type HotelCardData } from "@/components/search/HotelCard";
import { SearchBarOverlay } from "@/components/search/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SlidersHorizontal } from "lucide-react";
import { getRandomBackgroundImage } from "@/lib/background";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, Suspense } from "react";

const hotels: HotelCardData[] = [
  {
    id: "3104936b-2dd8-4de0-9a86-1aa5dd8f2b53",
    name: "Jumeirah Capri Palace",
    slug: "jumeirah-capri-palace",
    distance: "1.2 Kilometers to City Center",
    rating: 8.0,
    reviews: 324,
    price: 248,
    tags: ["Lake View", "Free Wi-Fi", "Incl. Breakfast", "Free Cancellation", "Wellness"],
    images: ["Jumeirah.avif", "Jumeirah-1.avif", "Jumeirah-2.avif"],
    description: {
      type: "Suite",
      bed: "1 King Bed",
      size: "100 m²",
    },
  },
  {
    id: "0083243e-4ba1-471a-bbda-c8140c4a8998",
    name: "Hotel de la Paix",
    slug: "hotel-de-la-paix",
    distance: "1.2 Kilometers to City Center",
    rating: 7.8,
    reviews: 654,
    price: 323,
    tags: ["Paris", "Luxury", "Incl. Dinner", "Eiffeltower View", "Rain Shower"],
    images: ["Jumeirah.avif"],
    description: {
      type: "Deluxe",
      bed: "1 King Bed",
      size: "100 m²",
    },
  },
  {
    id: "0095782c-bea6-4097-86a5-bb632c824046",
    name: "Amsterdam Grand Hotel",
    slug: "amsterdam-grand-hotel",
    distance: "1.2 Kilometers to City Center",
    rating: 9.3,
    reviews: 987,
    price: 128,
    tags: ["Amsterdam", "Pride Voucher", "Butler", "High-end Luxury", "Member Discount"],
    images: ["Jumeirah.avif"],
    description: {
      type: "Standard",
      bed: "1 King Bed",
      size: "100 m²",
    },
  },
];

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Parse URL params once as the committed "last searched" snapshot
  const committed = useMemo(() => ({
    destination: searchParams.get("destination") ?? "",
    checkIn: searchParams.get("arrival") ?? "",
    checkOut: searchParams.get("departure") ?? "",
    adults: Number(searchParams.get("adults") ?? 2),
    children: Number(searchParams.get("children") ?? 0),
    rooms: Number(searchParams.get("rooms") ?? 1),
  }), []);

  const [destination, setDestination] = useState(committed.destination);
  const [checkIn, setCheckIn] = useState(committed.checkIn);
  const [checkOut, setCheckOut] = useState(committed.checkOut);
  const [adults, setAdults] = useState(committed.adults);
  const [childCount, setChildCount] = useState(committed.children);
  const [rooms, setRooms] = useState(committed.rooms);

  const [openSearchBar, setOpenSearchBar] = useState(false);
  const [openDatePicker, setOpenDatePicker] = useState(false);
  const [openGuestSelector, setOpenGuestSelector] = useState(false);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);

  const [authError, setAuthError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("top");  

  const isDirty =
    destination !== committed.destination ||
    checkIn !== committed.checkIn ||
    checkOut !== committed.checkOut ||
    adults !== committed.adults ||
    childCount !== committed.children ||
    rooms !== committed.rooms;

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

      setBackgroundSrc(bg.url);
    }

    loadBackground();
  }, []);

  function performSearch() {
    const params = new URLSearchParams();
    if (destination) params.set("destination", destination);
    if (checkIn) params.set("arrival", checkIn);
    if (checkOut) params.set("departure", checkOut);
    if (adults) params.set("adults", adults.toString());
    if (childCount) params.set("children", childCount.toString());
    if (rooms) params.set("rooms", rooms.toString());

    const searchUrl = `/search?${params.toString()}`;
    router.push(searchUrl);
  }

  return (
    <div className="min-h-screen px-10 py-20 pb-[100px] font-sans">
      {/* Background layer */}
      <div
        className="fixed inset-0 bg-black bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: backgroundSrc ? `url('${backgroundSrc}')` : undefined,
        }}
      >
        <div
          className="absolute inset-0 backdrop-blur-md"
          style={{ background: "rgba(0,0,0,0.7)" }}
        />
      </div>

      <div className="flex flex-col">
        <Nav authError={authError} onDismissAuthError={() => setAuthError(null)} />

        {/* Searchbar + results bar — scrolls with content */}
        <div className="relative z-50 mx-auto w-full max-w-4xl">
          <SearchBarOverlay
            destination={destination}
            setDestination={setDestination}
            checkIn={checkIn}
            setCheckIn={setCheckIn}
            checkOut={checkOut}
            setCheckOut={setCheckOut}
            adults={adults}
            setAdults={setAdults}
            childCount={childCount}
            setChildCount={setChildCount}
            rooms={rooms}
            setRooms={setRooms}
            openSearchBar={openSearchBar}
            setOpenSearchBar={setOpenSearchBar}
            openDatePicker={openDatePicker}
            setOpenDatePicker={setOpenDatePicker}
            openGuestSelector={openGuestSelector}
            setOpenGuestSelector={setOpenGuestSelector}
            onSearch={performSearch}
            isDirty={isDirty}
          />
          {/* Results bar */}
          <div className="flex items-center justify-between mb-6 mt-3 ml-3 mr-3">
            <p className="font-sans text-sm text-white/60">
              We found{" "}
              <span className="font-semibold text-white/90">{hotels.length}</span>{" "}
              places that fit your search
            </p>
            <div className="flex items-center gap-2">
              <button className="flex h-9 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 font-sans text-sm text-white/80 backdrop-blur-sm transition-colors hover:bg-white/15">
                <SlidersHorizontal className="h-4 w-4 text-white/50" />
                Filters
              </button>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-9 w-44 rounded-xl border border-white/20 bg-white/10 font-sans text-sm text-white/80 backdrop-blur-sm focus:ring-0 focus:ring-offset-0 [&>svg]:text-white/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border border-white/20 bg-[rgba(18,18,18,0.96)] backdrop-blur-md">
                  <SelectItem value="top" className="font-sans text-sm text-white/80 focus:bg-white/10 focus:text-white">Recommended</SelectItem>
                  <SelectItem value="price_asc" className="font-sans text-sm text-white/80 focus:bg-white/10 focus:text-white">Price: low to high</SelectItem>
                  <SelectItem value="price_desc" className="font-sans text-sm text-white/80 focus:bg-white/10 focus:text-white">Price: high to low</SelectItem>
                  <SelectItem value="rating" className="font-sans text-sm text-white/80 focus:bg-white/10 focus:text-white">Highest rated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Hotel cards */}
        <div className="relative z-10 mx-auto max-w-5xl w-full">
          <div className="grid grid-cols-1 gap-8 items-start md:grid-cols-2 lg:grid-cols-3">
            {hotels.map((hotel) => (
              <HotelCard key={hotel.id} hotel={hotel} />
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageInner />
    </Suspense>
  );
}
