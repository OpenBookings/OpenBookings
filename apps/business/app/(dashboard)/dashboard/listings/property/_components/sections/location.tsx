"use client";

import * as React from "react";
import type { MapMouseEvent } from "maplibre-gl";
import { toast } from "sonner";
import { MapPinIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Map, MapMarker, MarkerContent, useMap } from "@/components/ui/map";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveHighlights, saveLocation } from "../../_lib/actions";
import { hasPin } from "../../_lib/geo";
import { SectionForm } from "../section-form";
import type { SectionProps } from "./props";

/** The lucide names offered for a nearby highlight, matching the listing page's vocabulary. */
const HIGHLIGHT_ICONS = [
  "Waves", "Utensils", "Coffee", "Landmark", "ShoppingBag",
  "TreePine", "Train", "Plane", "Bus", "Car", "Bike", "MapPin",
] as const;

/** Where the map opens for a host who has not placed a pin: most of Europe. */
const UNPINNED_CENTER: [number, number] = [4.9, 52.37];
const UNPINNED_ZOOM = 3;
/** Close enough to pick a doorway rather than a district. */
const PINNED_ZOOM = 15;

/**
 * Click-to-place, because `Map` exposes no click prop and a host whose property
 * arrives without coordinates has no pin to drag. It reaches the map instance
 * through the context `Map` publishes to its children, and lives here rather
 * than in components/ui/map.tsx: placing a pin is this screen's job, not the
 * map primitive's.
 */
function PinPlacer({ onPick }: { onPick: (lon: number, lat: number) => void }) {
  const { map } = useMap();
  const onPickRef = React.useRef(onPick);
  React.useEffect(() => {
    onPickRef.current = onPick;
  });

  React.useEffect(() => {
    if (!map) return;

    const handleClick = (e: MapMouseEvent) => {
      // Markers are DOM siblings inside the map container, so a click on the
      // pin itself bubbles here too. Only the canvas means "I meant that spot".
      if (!(e.originalEvent.target instanceof HTMLCanvasElement)) return;

      const { lng, lat } = e.lngLat;
      onPickRef.current(lng, lat);
      // Placing from the world view leaves the host too far out to judge what
      // they picked, so close in — but never back out of a zoom they chose.
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), PINNED_ZOOM) });
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [map]);

  return null;
}

export function LocationSection({ data, onDirtyChange }: SectionProps) {
  const { property, content, highlights } = data;
  const [lat, setLat] = React.useState(property.lat);
  const [lon, setLon] = React.useState(property.lon);
  const [rows, setRows] = React.useState(
    highlights.map((h) => ({ id: h.id, label: h.label, icon: h.icon, distance: h.distance })),
  );
  const [savingHighlights, setSavingHighlights] = React.useState(false);

  // The editor used to ask `lat !== null`, but the pin never arrives as null:
  // `properties.location` is NOT NULL, so onboarding stores the 0,0 sentinel
  // (see _lib/geo.ts). That read opened the map at street zoom over open ocean
  // and then refused to save it. hasPin is the same rule the checklist and the
  // save schema use.
  const pinned = hasPin(lat, lon);

  function movePin(nextLon: number, nextLat: number, markDirty: () => void) {
    setLon(nextLon);
    setLat(nextLat);
    // React writing a hidden input's value fires no input event, so the form's
    // own onChange never sees this. Without saying so, a moved pin reads as
    // "All changes saved" and the navigation guard lets it be thrown away.
    markDirty();
  }

  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
  const styleId = process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID;
  const mapStyle =
    maptilerKey && styleId
      ? `https://api.maptiler.com/maps/${styleId}/style.json?key=${maptilerKey}`
      : undefined;

  async function persistHighlights() {
    setSavingHighlights(true);
    await saveHighlights(
      property.id,
      rows.map(({ label, icon, distance }) => ({ label, icon, distance })),
    );
    setSavingHighlights(false);
    toast.success("Saved", { description: "Nearby highlights are up to date." });
  }

  return (
    <SectionForm
      sectionId="location"
      title="Location"
      description="Where you are, and what is worth walking to."
      propertyId={property.id}
      initialValues={{} as Record<string, unknown>}
      action={saveLocation}
      onDirtyChange={onDirtyChange}
      onReset={() => {
        setLat(property.lat);
        setLon(property.lon);
      }}
    >
      {(state, pending, markDirty) => (
        <FieldGroup className="max-w-3xl">
          <Field data-invalid={!!state.errors?.locationAbout}>
            <FieldLabel htmlFor="locationAbout">About</FieldLabel>
            <Textarea
              id="locationAbout"
              name="locationAbout"
              defaultValue={content.locationAbout ?? ""}
              disabled={pending}
              aria-invalid={!!state.errors?.locationAbout}
              rows={3}
              className="resize-none"
              placeholder="Twenty minutes from the airport, and a world away from it."
            />
            {state.errors?.locationAbout && <FieldError>{state.errors.locationAbout[0]}</FieldError>}
          </Field>

          <FieldSeparator />

          <Field data-invalid={!!state.errors?.addressLine1}>
            <FieldLabel htmlFor="addressLine1">Address</FieldLabel>
            <Input
              id="addressLine1"
              name="addressLine1"
              defaultValue={property.addressLine1}
              disabled={pending}
              aria-invalid={!!state.errors?.addressLine1}
            />
            {state.errors?.addressLine1 && <FieldError>{state.errors.addressLine1[0]}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="addressLine2">Address line 2</FieldLabel>
            <Input
              id="addressLine2"
              name="addressLine2"
              defaultValue={property.addressLine2 ?? ""}
              disabled={pending}
              placeholder="Optional"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field data-invalid={!!state.errors?.postalCode}>
              <FieldLabel htmlFor="postalCode">Postal code</FieldLabel>
              <Input
                id="postalCode"
                name="postalCode"
                defaultValue={property.postalCode ?? ""}
                disabled={pending}
                aria-invalid={!!state.errors?.postalCode}
              />
              {state.errors?.postalCode && <FieldError>{state.errors.postalCode[0]}</FieldError>}
            </Field>

            <Field data-invalid={!!state.errors?.city}>
              <FieldLabel htmlFor="city">City</FieldLabel>
              <Input
                id="city"
                name="city"
                defaultValue={property.city}
                disabled={pending}
                aria-invalid={!!state.errors?.city}
              />
              {state.errors?.city && <FieldError>{state.errors.city[0]}</FieldError>}
            </Field>

            <Field data-invalid={!!state.errors?.country}>
              <FieldLabel htmlFor="country">Country</FieldLabel>
              <Input
                id="country"
                name="country"
                defaultValue={property.country}
                disabled={pending}
                maxLength={2}
                aria-invalid={!!state.errors?.country}
                placeholder="NL"
              />
              <FieldDescription>Two-letter code.</FieldDescription>
              {state.errors?.country && <FieldError>{state.errors.country[0]}</FieldError>}
            </Field>
          </div>

          <Field data-invalid={!!state.errors?.timezone}>
            <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
            <Input
              id="timezone"
              name="timezone"
              defaultValue={property.timezone}
              disabled={pending}
              aria-invalid={!!state.errors?.timezone}
              placeholder="Europe/Amsterdam"
            />
            <FieldDescription>
              IANA name. This decides what date a booking falls on for your property.
            </FieldDescription>
            {state.errors?.timezone && <FieldError>{state.errors.timezone[0]}</FieldError>}
          </Field>

          <Field data-invalid={!!state.errors?.lat || !!state.errors?.lon}>
            <FieldLabel>Map pin</FieldLabel>
            <FieldDescription>
              {pinned
                ? "Drag the pin to where guests should arrive, or click the map to move it."
                : "Click the map to drop a pin where guests should arrive."}
            </FieldDescription>
            {/*
              Empty rather than "0" when there is no pin: the save schema reads
              a blank as "not answered" and says so in the host's own words,
              where a literal 0,0 would look like a deliberate answer.
            */}
            <input type="hidden" name="lat" value={pinned ? String(lat) : ""} />
            <input type="hidden" name="lon" value={pinned ? String(lon) : ""} />
            <div className="relative h-80 overflow-hidden rounded-lg border">
              <Map
                styles={mapStyle ? { dark: mapStyle, light: mapStyle } : undefined}
                center={pinned ? [lon!, lat!] : UNPINNED_CENTER}
                zoom={pinned ? PINNED_ZOOM : UNPINNED_ZOOM}
              >
                <PinPlacer onPick={(nextLon, nextLat) => movePin(nextLon, nextLat, markDirty)} />
                {pinned && (
                  <MapMarker
                    longitude={lon!}
                    latitude={lat!}
                    draggable
                    onDragEnd={({ lng, lat: newLat }) => movePin(lng, newLat, markDirty)}
                  >
                    <MarkerContent>
                      <svg width="28" height="36" viewBox="0 0 24 30" fill="none" aria-hidden="true">
                        <path
                          d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 21 9 21s9-14.25 9-21c0-4.97-4.03-9-9-9z"
                          fill="var(--ob-brand)"
                        />
                        <circle cx="12" cy="9" r="3.5" fill="white" />
                      </svg>
                    </MarkerContent>
                  </MapMarker>
                )}
              </Map>

              {/*
                pointer-events-none throughout: the prompt says "click the map",
                so it must not be the thing that swallows the click.
              */}
              {!pinned && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 backdrop-blur-[2px]">
                  <div className="flex size-11 items-center justify-center rounded-full bg-background/80 ring-1 ring-border">
                    <MapPinIcon className="size-5 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-sm">No pin yet</p>
                  <p className="max-w-64 text-center text-muted-foreground text-xs">
                    Click where guests should arrive. You can drag it afterwards.
                  </p>
                </div>
              )}
            </div>
            {(state.errors?.lat || state.errors?.lon) && (
              <FieldError>{(state.errors.lat ?? state.errors.lon)![0]}</FieldError>
            )}
          </Field>

          <FieldSeparator />

          {/*
            Highlights save on their own button, not the section's. They are
            optional, so blocking them behind the required address fields would
            mean a host cannot add a restaurant until they have fixed a postcode
            they did not come here to change.
          */}
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-medium text-sm">Nearby</p>
              <p className="text-muted-foreground text-sm">
                Optional. What is worth walking to, and how far it is.
              </p>
            </div>

            {rows.map((row, index) => (
              <div key={row.id} className="grid grid-cols-[1fr_10rem_7rem_auto] items-center gap-2">
                <Input
                  aria-label={`Nearby place ${index + 1} name`}
                  value={row.label}
                  placeholder="Il Corallo Restaurant"
                  onChange={(e) =>
                    setRows((r) => r.map((x, i) => (i === index ? { ...x, label: e.target.value } : x)))
                  }
                />
                <Select
                  value={row.icon}
                  onValueChange={(icon) =>
                    setRows((r) => r.map((x, i) => (i === index ? { ...x, icon } : x)))
                  }
                >
                  <SelectTrigger aria-label={`Nearby place ${index + 1} icon`}>
                    <SelectValue placeholder="Icon" />
                  </SelectTrigger>
                  <SelectContent>
                    {HIGHLIGHT_ICONS.map((icon) => (
                      <SelectItem key={icon} value={icon}>{icon}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`Nearby place ${index + 1} distance`}
                  value={row.distance}
                  placeholder="120 m"
                  onChange={(e) =>
                    setRows((r) => r.map((x, i) => (i === index ? { ...x, distance: e.target.value } : x)))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove nearby place ${index + 1}`}
                  onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={rows.length >= 12}
                onClick={() =>
                  setRows((r) => [...r, { id: crypto.randomUUID(), label: "", icon: "MapPin", distance: "" }])
                }
              >
                <PlusIcon />
                Add place
              </Button>
              <Button type="button" variant="secondary" size="xs" disabled={savingHighlights} onClick={persistHighlights}>
                Save nearby places
              </Button>
            </div>
          </div>
        </FieldGroup>
      )}
    </SectionForm>
  );
}
