"use client";
import { Nav } from "@/components/nav";
import { FooterLinks } from "@/components/FooterLinks";
import { StayPosterCard } from "@/components/search/StayPosterCard";
import { StayPosterSkeleton } from "@/components/search/StayPosterSkeleton";
import {
  comparePrice,
  resultsListLabel,
  type PriceMode,
  type StayPosterData,
} from "@/components/search/stay-poster-data";
import { SearchBarOverlay } from "@/components/search/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SlidersHorizontal } from "lucide-react";
import { GlassBackdrop } from "@/components/GlassBackdrop";
import type { Backdrop } from "@openbookings/images";
import { useBackdrop } from "@openbookings/images/react";
import { mapSearchResult, type HotelSearchApiResult } from "@/lib/search-results";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, Suspense } from "react";

// 1072 = the 1120px content width minus the 24px side padding the page already has.
const RESULTS_GRID =
  "mx-auto grid w-full max-w-[1072px] grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] sm:gap-x-8 sm:gap-y-10";

const PRICE_MODES: { mode: PriceMode; label: string }[] = [
  { mode: "total", label: "Total" },
  { mode: "night", label: "Per night" },
];

function SearchPageInner({ backdrops }: { backdrops: readonly Backdrop[] }) {
  const backdrop = useBackdrop(backdrops);
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
  const [authError, setAuthError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("top");

  const [hotels, setHotels] = useState<StayPosterData[]>([]);
  // Resets to the all-in total on every visit; whether to remember it is still open.
  const [priceMode, setPriceMode] = useState<PriceMode>("total");
  // Starts true when the URL holds a full search, so the first paint shows the
  // skeletons rather than a flash of "No hotels matched".
  const [isLoading, setIsLoading] = useState(
    () => Boolean(committed.lat && committed.lon && committed.checkIn && committed.checkOut),
  );
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const clearResults = () => {
      setHotels([]);
      setSearchError(null);
    };

    if (!committed.lat || !committed.lon || !committed.checkIn || !committed.checkOut) {
      clearResults();
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
        // Names the demo hotels testing mode generates for a new area.
        if (committed.destination) params.set("place", committed.destination);
        const res = await fetch(`/api/query?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          // A 400 lists what was wrong in `errors`; other failures say it in `error`.
          throw new Error(body?.errors?.[0] ?? body?.error ?? `Search failed (${res.status})`);
        }
        const results: HotelSearchApiResult[] = await res.json();
        setHotels(results.map(mapSearchResult));
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
  }, [committed.lat, committed.lon, committed.checkIn, committed.checkOut, committed.adults, committed.children, committed.rooms, committed.destination]);

  // The property page reads the stay under the same names as /api/query.
  const stayQuery = useMemo(() => {
    if (!committed.checkIn || !committed.checkOut) return "";
    const params = new URLSearchParams({
      checkin: committed.checkIn,
      checkout: committed.checkOut,
      adults: String(committed.adults),
      children: String(committed.children),
      rooms: String(committed.rooms),
    });
    return `?${params.toString()}`;
  }, [committed]);

  const sortedHotels = useMemo(() => {
    const list = [...hotels];
    if (sortBy === "price_asc") return list.sort((a, b) => comparePrice(a, b, "asc"));
    if (sortBy === "price_desc") return list.sort((a, b) => comparePrice(a, b, "desc"));
    return list;
  }, [hotels, sortBy]);

  const isDirty =
    destination !== committed.destination ||
    checkIn !== committed.checkIn ||
    checkOut !== committed.checkOut ||
    adults !== committed.adults ||
    childCount !== committed.children ||
    rooms !== committed.rooms;


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
    <div className="min-h-screen px-4 py-20 pb-[100px] font-sans sm:px-6">
      <GlassBackdrop backdrop={backdrop} />

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
          <div className="mx-3 mt-3 mb-6 flex flex-wrap items-center justify-between gap-3">
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
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Show prices as"
                className="flex h-9 items-center rounded-xl border border-white/20 bg-white/10 p-0.5 backdrop-blur-sm"
              >
                {PRICE_MODES.map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={priceMode === mode}
                    onClick={() => setPriceMode(mode)}
                    className={
                      priceMode === mode
                        ? "h-full rounded-[10px] bg-white px-3 font-sans text-sm text-[#111114] transition-colors"
                        : "h-full rounded-[10px] px-3 font-sans text-sm text-white/80 transition-colors hover:text-white"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
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
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Results: 3 columns from 892px, 2 from 640px, 1 below (minmax 260px, 32px gaps). */}
        <div className="relative z-10">
          {isLoading ? (
            <ul aria-busy="true" aria-label="Loading stays" className={RESULTS_GRID}>
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i}>
                  <StayPosterSkeleton />
                </li>
              ))}
            </ul>
          ) : sortedHotels.length === 0 ? (
            // A failed search already shows its error in the results bar.
            searchError ? null : (
              <p className="text-center font-sans text-sm text-white/60">
                {committed.lat && committed.lon
                  ? "No hotels matched your search. Try different dates or guest counts."
                  : "Search for a destination to see available hotels."}
              </p>
            )
          ) : (
            <ul aria-label={resultsListLabel(sortedHotels.length, committed.destination)} className={RESULTS_GRID}>
              {sortedHotels.map((stay, index) => (
                <li key={stay.id}>
                  {/* The first row is above the fold at every width. */}
                  <StayPosterCard stay={stay} priceMode={priceMode} href={`/p/${stay.slug}${stayQuery}`} priority={index < 3} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <FooterLinks />
    </div>
  );
}

const noop = () => {};

/**
 * What the cached HTML shows until the browser takes over: the same backdrop,
 * nav, search bar and skeletons as the real page. `useSearchParams` makes the
 * page above it browser-only, so without this the prerendered page was empty
 * and visitors saw black until all the JavaScript had run.
 */
function SearchPageFallback({ backdrops }: { backdrops: readonly Backdrop[] }) {
  const backdrop = useBackdrop(backdrops);
  return (
    <div className="min-h-screen px-4 py-20 pb-[100px] font-sans sm:px-6">
      <GlassBackdrop backdrop={backdrop} />
      <div className="flex flex-col">
        <Nav />
        <div className="relative z-50 mx-auto w-full max-w-4xl">
          <SearchBarOverlay
            destination=""
            setDestination={noop}
            checkIn=""
            setCheckIn={noop}
            checkOut=""
            setCheckOut={noop}
            adults={2}
            setAdults={noop}
            childCount={0}
            setChildCount={noop}
            rooms={1}
            setRooms={noop}
            openSearchBar={false}
            setOpenSearchBar={noop}
            openDatePicker={false}
            setOpenDatePicker={noop}
            openGuestSelector={false}
            setOpenGuestSelector={noop}
            onSearch={noop}
          />
          <p className="mx-3 mt-3 mb-6 flex h-9 items-center font-sans text-sm text-white/60">Searching…</p>
        </div>
        <ul aria-busy="true" aria-label="Loading stays" className={`relative z-10 ${RESULTS_GRID}`}>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <StayPosterSkeleton />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SearchClient({ backdrops }: { backdrops: readonly Backdrop[] }) {
  return (
    <Suspense fallback={<SearchPageFallback backdrops={backdrops} />}>
      <SearchPageInner backdrops={backdrops} />
    </Suspense>
  );
}
