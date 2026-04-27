"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloudIcon, XIcon, FileTextIcon, ImageIcon, MapPinIcon, SearchIcon } from "lucide-react";
import MapLibreGL from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

interface PhotoPreview {
  id: string;
  url: string;
  name: string;
}

export interface CoreInfoValues {
  displayName: string;
  description: string;
  streetAddress: string;
  city: string;
  country: string;
  postalCode: string;
  coordinates: [number, number] | null;
  photos: File[];
  houseRulesText: string;
}

interface CoreInfoStepProps {
  values: CoreInfoValues;
  onChange: (values: Partial<CoreInfoValues>) => void;
}

// ---------------------------------------------------------------------------
// Mini map component
// ---------------------------------------------------------------------------
function AddressMap({ coordinates }: { coordinates: [number, number] | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreGL.Map | null>(null);
  const markerRef = useRef<MapLibreGL.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreGL.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: coordinates ?? [8, 46],
      zoom: coordinates ? 14 : 2,
      interactive: false,
      attributionControl: false,
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!coordinates) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (markerRef.current) {
      markerRef.current.setLngLat(coordinates);
    } else {
      const el = document.createElement("div");
      el.className = "address-pin";
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 24 30" fill="none">
        <path d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 21 9 21s9-14.25 9-21c0-4.97-4.03-9-9-9z" fill="#3b82f6"/>
        <circle cx="12" cy="9" r="3.5" fill="white"/>
      </svg>`;
      el.style.cssText = "width:28px;height:36px;cursor:default;transform:translateY(-18px)";
      markerRef.current = new MapLibreGL.Marker({ element: el, anchor: "bottom" })
        .setLngLat(coordinates)
        .addTo(map);
    }

    map.flyTo({ center: coordinates, zoom: 15, duration: 1000 });
  }, [coordinates]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-white/10">
      <div ref={containerRef} className="size-full" />
      {!coordinates && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30 backdrop-blur-sm">
          <MapPinIcon className="size-7 text-white/30" />
          <p className="text-xs text-white/30">Enter an address to see the pin</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Address geocode autocomplete
// ---------------------------------------------------------------------------
// Matches common postal code formats: NL "1234 AB", DE/FR/US "12345", UK "SW1A 2AA", BE "1000"
const POSTAL_CODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}|\d{4,5}(?:\s?[A-Z]{2})?)\b/i;

function parseGeocodeFeature(feature: Record<string, unknown>): GeocodeSuggestion {
  const context = (feature.context as Array<{ id: string; text: string }>) ?? [];

  // MapTiler context IDs follow "type.number" — check multiple aliases
  const postalCtx = context.find(
    (c) => c.id.startsWith("postcode") || c.id.startsWith("postal_code") || c.id.startsWith("zip")
  );
  const city =
    context.find((c) => c.id.startsWith("place") || c.id.startsWith("locality"))?.text ?? "";
  const country = context.find((c) => c.id.startsWith("country"))?.text ?? "";

  // Fall back to regex extraction from place_name if context didn't yield a postal code
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

  // Show confirmed state if fields are filled
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
      // silently ignore network errors
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

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={containerRef} className="relative flex flex-col gap-2">
      {/* Search input */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          placeholder="Search address…"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
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

      {/* Suggestions dropdown */}
      {open && suggestions.length > 0 && (
        <div className="absolute top-full z-50 mt-1 w-full overflow-hidden rounded-md border border-white/10 bg-[#1a1d23] shadow-xl">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/5 text-white/80"
            >
              <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-blue-400/70" />
              <span className="text-white/80">{s.placeName}</span>
            </button>
          ))}
        </div>
      )}

      {/* Confirmed address fields */}
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
export function CoreInfoStep({ values, onChange }: CoreInfoStepProps) {
  const [photoPreviews, setPhotoPreviews] = useState<PhotoPreview[]>([]);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [rulesDragOver, setRulesDragOver] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const rulesInputRef = useRef<HTMLInputElement>(null);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const newFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const newPreviews: PhotoPreview[] = newFiles.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      url: URL.createObjectURL(f),
      name: f.name,
    }));
    setPhotoPreviews((prev) => [...prev, ...newPreviews]);
    onChange({ photos: [...values.photos, ...newFiles] });
  }

  function removePhoto(id: string, index: number) {
    setPhotoPreviews((prev) => prev.filter((p) => p.id !== id));
    onChange({ photos: values.photos.filter((_, i) => i !== index) });
  }

  async function handleRulesFile(files: FileList | null) {
    if (!files?.[0]) return;
    const file = files[0];
    if (file.type === "text/plain") {
      const text = await file.text();
      onChange({ houseRulesText: text });
    }
  }

  function handleAddressSelect(s: GeocodeSuggestion) {
    onChange({
      streetAddress: s.street,
      city: s.city,
      country: s.country,
      postalCode: s.postalCode,
      coordinates: s.center,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top section: Name + Address left, Map right */}
      <div className="grid grid-cols-[1fr_260px] gap-4 items-start">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName" className="text-white/70 text-xs font-medium uppercase tracking-wide">
              Property Name <span className="text-destructive text-xl">*</span>
            </Label>
            <Input
              id="displayName"
              placeholder="e.g. The Grand Harbour Hotel"
              value={values.displayName}
              onChange={(e) => onChange({ displayName: e.target.value })}
              className="text-white/80"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-white/70 text-xs font-medium uppercase tracking-wide">
              Address <span className="text-destructive text-xl">*</span>
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
        </div>

        {/* Right column: map stretches to match left height */}
        <div className="self-stretch min-h-[180px] ">
          <AddressMap coordinates={values.coordinates} />
        </div>
      </div>

      {/* Description — full width below the split */}
      <div className="flex flex-col gap-2 sm:gap-1.5">
        <Label htmlFor="description" className="text-white/70 text-xs font-medium uppercase tracking-wide">
          Description
        </Label>
        <Textarea
          id="description"
          placeholder="Describe your property — location highlights, vibe, amenities…"
          rows={3}
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className="resize-none transition-shadow focus-visible:ring-2 focus-visible:ring-blue-400/50 text-white/80"
        />
      </div>


      {/* Row 4: Photo upload */}
      <div className="flex flex-col gap-2">
        <Label className="text-white/70 text-xs font-medium uppercase tracking-wide">
          Property Photos
        </Label>

        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addPhotos(e.target.files)}
        />

        {photoPreviews.length === 0 ? (
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setPhotoDragOver(true); }}
            onDragLeave={() => setPhotoDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setPhotoDragOver(false);
              addPhotos(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 transition-colors",
              photoDragOver
                ? "border-blue-500/60 bg-blue-500/5"
                : "border-white/10 bg-white/2 hover:border-white/20 hover:bg-white/4"
            )}
          >
            <div className="flex size-10 items-center justify-center rounded-full bg-white/5">
              <UploadCloudIcon className="size-5 text-white/40" />
            </div>
            <div className="text-center">
              <p className="text-sm text-white/60">
                <span className="text-blue-400">Click to upload</span> or drag & drop
              </p>
              <p className="mt-0.5 text-xs text-white/30">PNG, JPG, WEBP up to 10 MB each</p>
            </div>
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {photoPreviews.map((preview, i) => (
              <div key={preview.id} className="group relative aspect-video overflow-hidden rounded-md border border-white/10">
                <img src={preview.url} alt={preview.name} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(preview.id, i)}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <XIcon className="size-3 text-white" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="flex aspect-video items-center justify-center rounded-md border border-dashed border-white/10 bg-white/2 transition-colors hover:border-white/20 hover:bg-white/4"
            >
              <ImageIcon className="size-5 text-white/25" />
            </button>
          </div>
        )}
      </div>

      {/* Row 5: House Rules */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="houseRules" className="text-white/70 text-xs font-medium uppercase tracking-wide">
            House Rules <span className="text-white/30">(optional)</span>
          </Label>
          <button
            type="button"
            onClick={() => rulesInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            <FileTextIcon className="size-3.5" />
            Import from file
          </button>
          <input
            ref={rulesInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => handleRulesFile(e.target.files)}
          />
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setRulesDragOver(true); }}
          onDragLeave={() => setRulesDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setRulesDragOver(false);
            handleRulesFile(e.dataTransfer.files);
          }}
          className={cn("rounded-lg transition-colors", rulesDragOver && "ring-1 ring-blue-500/50")}
        >
          <Textarea
            id="houseRules"
            placeholder="e.g. No smoking, no parties. Check-in from 15:00, check-out by 11:00…"
            rows={4}
            value={values.houseRulesText}
            onChange={(e) => onChange({ houseRulesText: e.target.value })}
            className="resize-none"
          />
        </div>
        <p className="text-xs text-white/25">Drag a .txt file onto the text area to auto-fill</p>
      </div>
    </div>
  );
}
