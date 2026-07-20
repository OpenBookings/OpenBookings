"use client";

import { useCallback, useRef, useState } from "react";
import { MapPinIcon, SearchIcon, PlusIcon, MinusIcon } from "lucide-react";
import { Map, MapMarker, MarkerContent, type MapRef } from "@/components/ui/map";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_API_KEY ?? "";
const MAPTILER_STYLE_ID = process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID ?? "";
const MAP_STYLE = `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID}/style.json?key=${MAPTILER_KEY}`;

interface GeocodeSuggestion {
  id: string;
  placeName: string;
  center: [number, number];
  street: string;
  city: string;
  country: string;
  postalCode: string;
}

export interface CoreInfoLocationValues {
  streetAddress: string;
  city: string;
  country: string;
  postalCode: string;
  coordinates: [number, number] | null;
}

interface CoreInfoLocationStepProps {
  values: CoreInfoLocationValues;
  onChange: (values: Partial<CoreInfoLocationValues>) => void;
}

// ---------------------------------------------------------------------------
// Postal code regex (NL, DE, FR, US, UK, BE)
// ---------------------------------------------------------------------------
const POSTAL_CODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}|\d{4,5}(?:\s?[A-Z]{2})?)\b/i;

function parseGeocodeFeature(feature: Record<string, unknown>): GeocodeSuggestion {
  const context = (feature.context as Array<{ id: string; text: string }>) ?? [];
  const postalCtx = context.find(
    (c) => c.id.startsWith("postcode") || c.id.startsWith("postal_code") || c.id.startsWith("zip")
  );
  const city =
    context.find((c) => c.id.startsWith("place") || c.id.startsWith("locality"))?.text ?? "";
  const country = context.find((c) => c.id.startsWith("country"))?.text ?? "";
  const placeName = (feature.place_name as string) ?? "";
  const postalCode = postalCtx?.text ?? POSTAL_CODE_RE.exec(placeName)?.[1] ?? "";
  const streetNum = (feature.address as string) ?? "";
  const streetName = (feature.text as string) ?? "";
  const street = streetNum ? `${streetName} ${streetNum}` : streetName;

  return {
    id: (feature.id as string) ?? String(Math.random()),
    placeName,
    center: feature.center as [number, number],
    street,
    city,
    country,
    postalCode,
  };
}

// ---------------------------------------------------------------------------
// Address search autocomplete
// ---------------------------------------------------------------------------
function AddressSearch({
  streetAddress,
  city,
  postalCode,
  country,
  onSelect,
  onFieldChange,
}: {
  streetAddress: string;
  city: string;
  postalCode: string;
  country: string;
  onSelect: (s: GeocodeSuggestion) => void;
  onFieldChange: (field: "streetAddress" | "city" | "postalCode" | "country", value: string) => void;
}) {
  const hasPrefilledAddress = Boolean(streetAddress && city);
  const [query, setQuery] = useState(() =>
    hasPrefilledAddress ? [streetAddress, city, country].filter(Boolean).join(", ") : ""
  );
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(hasPrefilledAddress);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isConfirmed = confirmed && streetAddress && city;

  const search = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); return; }
    setLoading(true);
    try {
      const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${MAPTILER_KEY}&types=address&limit=5&language=en`;
      const res = await fetch(url);
      const data = await res.json();
      setSuggestions((data.features ?? []).map(parseGeocodeFeature));
      setOpen(true);
    } catch {
      // ignore network errors
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    setConfirmed(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 380);
  }

  function handleSelect(s: GeocodeSuggestion) {
    setQuery(s.placeName);
    setOpen(false);
    setConfirmed(true);
    setSuggestions([]);
    onSelect(s);
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          placeholder="Search address…"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className={cn(
            "h-9 w-full rounded-md border bg-transparent pl-8 pr-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none",
            "placeholder:text-muted-foreground",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            "text-muted-foreground focus-visible:text-white/80 border-input"
          )}
          autoComplete="off"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="size-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          </div>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute top-full z-50 mt-1 w-full overflow-hidden rounded-md border border-white/10 bg-[#1a1d23] shadow-xl">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/5 text-white/80"
            >
              <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-ob-brand-light/70" />
              <span className="text-white/80">{s.placeName}</span>
            </button>
          ))}
        </div>
      )}

      {isConfirmed && (
        <div className="flex flex-col gap-2 pt-1">
          <Input
            placeholder="Street address"
            value={streetAddress}
            onChange={(e) => onFieldChange("streetAddress", e.target.value)}
            className="text-sm text-white/80"
          />
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="City" value={city} onChange={(e) => onFieldChange("city", e.target.value)} className="text-sm text-white/80" />
            <Input placeholder="Postal code" value={postalCode} onChange={(e) => onFieldChange("postalCode", e.target.value)} className="text-sm text-white/80" />
            <Input placeholder="Country" value={country} onChange={(e) => onFieldChange("country", e.target.value)} className="text-sm text-white/80" />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------
export function CoreInfoLocationStep({ values, onChange }: CoreInfoLocationStepProps) {
  const mapRef = useRef<MapRef>(null);

  function handleAddressSelect(s: GeocodeSuggestion) {
    onChange({
      streetAddress: s.street,
      city: s.city,
      country: s.country,
      postalCode: s.postalCode,
      coordinates: s.center,
    });
    mapRef.current?.flyTo({ center: s.center, zoom: 16, duration: 900, essential: true });
  }

  function zoomIn() { mapRef.current?.zoomIn({ duration: 250 }); }
  function zoomOut() { mapRef.current?.zoomOut({ duration: 250 }); }

  return (
    <div className="flex flex-col gap-4">
      {/* Address search */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/60 text-xs font-medium">
          Property address <span className="text-red-400 ml-0.5">*</span>
        </Label>
        <AddressSearch
          streetAddress={values.streetAddress}
          city={values.city}
          postalCode={values.postalCode}
          country={values.country}
          onSelect={handleAddressSelect}
          onFieldChange={(field, value) => onChange({ [field]: value })}
        />
      </div>

      {/* Large map */}
      <div className="relative h-[380px] overflow-hidden rounded-xl border border-white/10">
        <Map
          ref={mapRef}
          styles={{ light: MAP_STYLE, dark: MAP_STYLE }}
          center={values.coordinates ?? [8, 46]}
          zoom={values.coordinates ? 15 : 2}
          attributionControl={false}
        >
          {values.coordinates && (
            <MapMarker longitude={values.coordinates[0]} latitude={values.coordinates[1]}>
              <MarkerContent>
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 24 30" fill="none">
                  <path d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 21 9 21s9-14.25 9-21c0-4.97-4.03-9-9-9z" fill="oklch(62% 0.21 268)"/>
                  <circle cx="12" cy="9" r="3.5" fill="white"/>
                </svg>
              </MarkerContent>
            </MapMarker>
          )}
        </Map>

        {!values.coordinates && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ob-sidebar/70 backdrop-blur-sm">
            <div className="flex size-12 items-center justify-center rounded-full bg-white/8 ring-1 ring-white/10">
              <MapPinIcon className="size-6 text-white/35" />
            </div>
            <p className="text-sm text-white/35">Search an address to place the pin</p>
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1 overflow-hidden rounded-lg border border-white/15 shadow-lg">
          <button
            type="button"
            onClick={zoomIn}
            aria-label="Zoom in"
            className="flex size-9 items-center justify-center bg-[#1a1d23]/90 backdrop-blur-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <PlusIcon className="size-4" strokeWidth={2} />
          </button>
          <div className="h-px bg-white/10" />
          <button
            type="button"
            onClick={zoomOut}
            aria-label="Zoom out"
            className="flex size-9 items-center justify-center bg-[#1a1d23]/90 backdrop-blur-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <MinusIcon className="size-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
