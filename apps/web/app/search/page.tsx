"use client";
import { Nav } from "@/components/nav";
import { HotelCard, type HotelCardData } from "@/components/search/HotelCard";
import { SearchBarOverlay } from "@/components/search/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SlidersHorizontal } from "lucide-react";
import { getRandomBackgroundImage } from "@/lib/background";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, Suspense } from "react";

/** Shape returned by GET /api/query — see resolveSearchResults() in app/api/query/calculator.ts */
interface HotelSearchApiResult {
  hotel_id: string;
  hotel_name: string;
  hotel_slug: string;
  city: string;
  country: string;
  hero_image_url: string | null;
  room_name: string;
  room_description: string;
  currency: string;
  is_refundable: boolean;
  total_price: number;
  nights: { date: string }[];
}

function mapToHotelCardData(result: HotelSearchApiResult): HotelCardData {
  const nightCount = result.nights.length || 1;
  const tags = [result.city, result.country, result.is_refundable ? "Free Cancellation" : "Non-refundable"].filter(
    Boolean,
  );

  return {
    id: result.hotel_id,
    name: result.hotel_name,
    slug: result.hotel_slug,
    distance: `${result.city}, ${result.country}`,
    rating: 0,
    reviews: 0,
    price: Math.round(result.total_price / nightCount),
    tags,
    images: result.hero_image_url ? [result.hero_image_url] : [],
    description: {
      type: result.room_name,
      bed: "",
      size: "",
    },
  };
}

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
    lat: searchParams.get("lat"),
    lon: searchParams.get("lon"),
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

  const [hotels, setHotels] = useState<HotelCardData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!committed.lat || !committed.lon || !committed.checkIn || !committed.checkOut) {
      setHotels([]);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();

    async function runSearch() {
      setIsLoading(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({
          lat: committed.lat as string,
          lon: committed.lon as string,
          checkin: committed.checkIn,
          checkout: committed.checkOut,
          adults: String(committed.adults),
          children: String(committed.children),
          rooms: String(committed.rooms),
        });
        const res = await fetch(`/api/query?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Search failed (${res.status})`);
        }
        const results: HotelSearchApiResult[] = await res.json();
        setHotels(results.map(mapToHotelCardData));
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setSearchError(err instanceof Error ? err.message : "Search failed");
        setHotels([]);
      } finally {
        setIsLoading(false);
      }
    }

    runSearch();
    return () => controller.abort();
  }, [committed.lat, committed.lon, committed.checkIn, committed.checkOut, committed.adults, committed.children, committed.rooms]);

  const sortedHotels = useMemo(() => {
    const list = [...hotels];
    if (sortBy === "price_asc") return list.sort((a, b) => a.price - b.price);
    if (sortBy === "price_desc") return list.sort((a, b) => b.price - a.price);
    if (sortBy === "rating") return list.sort((a, b) => b.rating - a.rating);
    return list;
  }, [hotels, sortBy]);

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

      const stored = localStorage.getItem("ob_backgrounds");
      if (stored) {
        try {
          bg = JSON.parse(stored);
        } catch {
          bg = getRandomBackgroundImage();
          localStorage.setItem("ob_backgrounds", JSON.stringify(bg));
        }
      } else {
        bg = getRandomBackgroundImage();
        localStorage.setItem("ob_backgrounds", JSON.stringify(bg));
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
    // No destination geocoding UI yet — carry the previously resolved
    // coordinates through so an unchanged destination keeps returning results.
    if (destination === committed.destination && committed.lat && committed.lon) {
      params.set("lat", committed.lat);
      params.set("lon", committed.lon);
    }

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
              {isLoading ? (
                "Searching…"
              ) : searchError ? (
                <span className="text-red-300">{searchError}</span>
              ) : (
                <>
                  We found{" "}
                  <span className="font-semibold text-white/90">{sortedHotels.length}</span>{" "}
                  places that fit your search
                </>
              )}
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
          {!isLoading && !searchError && sortedHotels.length === 0 ? (
            <p className="text-center font-sans text-sm text-white/60">
              {committed.lat && committed.lon
                ? "No hotels matched your search. Try different dates or guest counts."
                : "Search for a destination to see available hotels."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-8 items-start md:grid-cols-2 lg:grid-cols-3">
              {sortedHotels.map((hotel) => (
                <HotelCard key={hotel.id} hotel={hotel} />
              ))}
            </div>
          )}
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
