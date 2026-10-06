"use client";

import * as React from "react";
import type { MapMouseEvent } from "maplibre-gl";
import { toast } from "sonner";
import {
  CheckIcon,
  LocateFixedIcon,
  MapPinIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Map, MapMarker, MarkerContent, useMap, type MapRef } from "@/components/ui/map";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveHighlights, saveLocation } from "../../_lib/actions";
import { hasPin } from "../../_lib/geo";
import { EU_TIMEZONE_GROUPS, EU_TIMEZONES } from "../../_lib/timezones";
import type { FormState, PropertyEditorData } from "../../_lib/types";
import { locateTypedAddress, type AddressCandidate } from "../../_lib/address-lookup";
import { AddressFinder, type AddressValue, type FinderMode } from "../address-finder";
import { InfoTip } from "../info-tip";
import { SectionForm } from "../section-form";
import type { SectionProps } from "./props";

/** The lucide names offered for a nearby highlight, matching the listing page's vocabulary. */
const HIGHLIGHT_ICONS = [
  "Waves", "Utensils", "Coffee", "Landmark", "ShoppingBag",
  "TreePine", "Train", "Plane", "Bus", "Car", "Bike", "MapPin",
] as const;

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_API_KEY ?? "";
/** A typed address is placed once the host pauses, not per keystroke. */
const LOCATE_DEBOUNCE_MS = 800;

/** Where the map opens for a host who has not placed a pin: most of Europe. */
const UNPINNED_CENTER: [number, number] = [4.9, 52.37];
const UNPINNED_ZOOM = 3;
/** Close enough to pick a doorway rather than a district. */
const PINNED_ZOOM = 15;
/**
 * Where the pin came from, which is what the line under the map reports.
 * "manual" matters most: it is the host overriding the address, and the one
 * case where a wrong pin is on them rather than on the address register.
 */
type PinSource = "saved" | "address" | "manual" | "none";

/** The part of an address that says where it is, short of the street. */
function areaKey(a: { postalCode: string; city: string; country: string }): string {
  return [a.postalCode, a.city, a.country].map((v) => v.trim().toUpperCase()).join("|");
}

/**
 * Re-centre the map on a new pin. The `center` prop only applies when the map
 * is created, so a moved pin has to be pushed to the live instance — after a
 * resize, in case the container changed while the finder was open, and after
 * load, in case the style is still arriving.
 */
function refreshMap(map: MapRef | null, center: [number, number]) {
  // No instance yet: it will be created from the new lat/lon state.
  if (!map) return;
  const go = () => {
    map.stop();
    map.resize();
    map.flyTo({ center, zoom: PINNED_ZOOM, duration: 900, essential: true });
  };
  if (map.loaded()) go();
  else map.once("load", go);
}

/**
 * Click-to-place, because `Map` exposes no click prop. It reaches the map
 * instance through the context `Map` publishes to its children, and lives here
 * rather than in components/ui/map.tsx: placing a pin is this screen's job, not
 * the map primitive's. Mounted only while the host is editing the pinpoint.
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
  // The pin, address mirror and edit mode live in React state, which a form
  // reset cannot reach. Remounting the fields is what makes Discard put the
  // pin back where it was saved.
  const [resetKey, setResetKey] = React.useState(0);

  return (
    <SectionForm
      sectionId="location"
      title="Location"
      description="Where you are, and what is worth walking to."
      propertyId={data.property.id}
      initialValues={{} as Record<string, unknown>}
      action={saveLocation}
      onDirtyChange={onDirtyChange}
      onReset={() => setResetKey((k) => k + 1)}
    >
      {(state, pending, markDirty) => (
        <LocationFields
          key={resetKey}
          data={data}
          state={state}
          pending={pending}
          markDirty={markDirty}
        />
      )}
    </SectionForm>
  );
}

function LocationFields({
  data,
  state,
  pending,
  markDirty,
}: {
  data: PropertyEditorData;
  state: FormState<Record<string, unknown>>;
  pending: boolean;
  markDirty: () => void;
}) {
  const { property, content, highlights } = data;
  const mapRef = React.useRef<MapRef>(null);

  const [lat, setLat] = React.useState(property.lat);
  const [lon, setLon] = React.useState(property.lon);
  // The editor used to ask `lat !== null`, but the pin never arrives as null:
  // `properties.location` is NOT NULL, so onboarding stores the 0,0 sentinel
  // (see _lib/geo.ts). hasPin is the same rule the checklist and the save
  // schema use.
  const pinned = hasPin(lat, lon);
  // Set by hand (Edit pinpoint), the pin stops following the address — and
  // stays that way across sessions, via properties.pin_set_manually.
  const [pinManual, setPinManual] = React.useState(property.pinSetManually);
  const [pinSource, setPinSource] = React.useState<PinSource>(
    !pinned ? "none" : property.pinSetManually ? "manual" : "saved",
  );
  const [editingPin, setEditingPin] = React.useState(false);
  const [confirmEdit, setConfirmEdit] = React.useState(false);
  // Which state the address finder is in, so the map can say whether it is
  // showing the address on screen or the one before it.
  const [finderMode, setFinderMode] = React.useState<FinderMode>("view");
  const [pickedLabel, setPickedLabel] = React.useState<string | null>(null);

  // The address as the host last left it, and the edit the pin should follow.
  const savedAddress: AddressValue = {
    addressLine1: property.addressLine1,
    addressLine2: property.addressLine2 ?? "",
    postalCode: property.postalCode ?? "",
    city: property.city,
    country: property.country,
  };
  const [currentAddress, setCurrentAddress] = React.useState<AddressValue>(savedAddress);
  const [typed, setTyped] = React.useState<AddressValue | null>(null);
  // Where a pick that left lines blank put the pin. Filling those lines in is
  // completing the pick, not moving the property: "Località Follonata" cannot
  // be geocoded, and following it would throw away the spa's exact pin.
  const [pickArea, setPickArea] = React.useState<string | null>(null);
  const [locate, setLocate] = React.useState<
    "idle" | "locating" | "exact" | "approximate" | "not-found" | "failed"
  >("idle");

  const [timezone, setTimezone] = React.useState(property.timezone);

  const markDirtyRef = React.useRef(markDirty);
  React.useEffect(() => {
    markDirtyRef.current = markDirty;
  });

  function movePin(nextLon: number, nextLat: number) {
    setLon(nextLon);
    setLat(nextLat);
    // React writing a hidden input's value fires no input event, so the form's
    // own onChange never sees this. Without saying so, a moved pin reads as
    // "All changes saved" and the navigation guard lets it be thrown away.
    markDirtyRef.current();
  }

  /** A picked search result is a new location: the pin goes there and follows again. */
  function onPickAddress(c: AddressCandidate) {
    movePin(c.lon, c.lat);
    setPinManual(false);
    setPinSource("address");
    setPickedLabel(c.label);
    setLocate("idle");
    // Forget any earlier edit, or un-setting pinManual would re-place it.
    setTyped(null);
    setPickArea(c.missing.length > 0 ? areaKey(c) : null);
    setCurrentAddress((a) => ({
      ...a,
      addressLine1: c.addressLine1,
      addressLine2: "",
      postalCode: c.postalCode,
      city: c.city,
      country: c.country,
    }));
    refreshMap(mapRef.current, [c.lon, c.lat]);
  }

  function onEditAddress(a: AddressValue) {
    setCurrentAddress(a);
    if (pickArea && areaKey(a) === pickArea) return;
    // Postcode, city or country changed: this is a new address, so follow it.
    setPickArea(null);
    setTyped(a);
  }

  /** The host placed the pin themselves: it stops following the address. */
  function placedByHand(nextLon: number, nextLat: number) {
    movePin(nextLon, nextLat);
    setPinManual(true);
    setPinSource("manual");
    setLocate("idle");
  }

  /** Undo "set by hand": place the pin from the address as it stands now. */
  function followAddress() {
    setPinManual(false);
    setPickArea(null);
    markDirtyRef.current();
    setTyped({ ...currentAddress });
  }

  // Address → pin. While the pin follows the address, every edit to a line
  // that locates it (not line 2) places it again: exactly where the house is
  // known, approximately where only the street or place is, and not at all
  // when nothing found is about what was typed. Then the old pin is cleared,
  // because it belongs to the old address, and the host is told to set it;
  // the cleared pin is also what stops the save, since the schema refuses a
  // listing without one.
  const typedRef = React.useRef(typed);
  React.useEffect(() => {
    typedRef.current = typed;
  });
  const typedKey = typed
    ? [typed.addressLine1, typed.postalCode, typed.city, typed.country].map((v) => v.trim()).join("|")
    : null;

  React.useEffect(() => {
    const address = typedRef.current;
    if (!typedKey || !address || pinManual) return;
    if (!address.addressLine1.trim()) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLocate("locating");
      try {
        const hit = await locateTypedAddress(address, MAPTILER_KEY, controller.signal);
        if (controller.signal.aborted) return;
        if (!hit) {
          setLat(null);
          setLon(null);
          markDirtyRef.current();
          setPinSource("none");
          setLocate("not-found");
          return;
        }
        movePin(hit.lon, hit.lat);
        setPinSource("address");
        setPickedLabel(hit.label);
        setLocate(hit.precision);
        refreshMap(mapRef.current, [hit.lon, hit.lat]);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Placing the address failed:", err);
        setLocate("failed");
      }
    }, LOCATE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [typedKey, pinManual]);

  const [rows, setRows] = React.useState(
    highlights.map((h) => ({ id: h.id, label: h.label, icon: h.icon, distance: h.distance })),
  );
  const [savingHighlights, setSavingHighlights] = React.useState(false);

  async function persistHighlights() {
    setSavingHighlights(true);
    await saveHighlights(
      property.id,
      rows.map(({ label, icon, distance }) => ({ label, icon, distance })),
    );
    setSavingHighlights(false);
    toast.success("Saved", { description: "Nearby highlights are up to date." });
  }

  const pinStatus = (() => {
    switch (locate) {
      case "locating":
        return "Placing your typed address on the map…";
      case "approximate":
        return `Pin placed approximately, at ${pickedLabel}. Check it, and use Edit pinpoint to correct it.`;
      case "not-found":
        return "We could not find this address on the map.";
      case "failed":
        return "The map could not place your address just now. Edit it to try again, or set the pin yourself.";
    }
    if (pinManual && pinned) {
      return "You set this pin by hand, so it stays put when you edit the address.";
    }
    switch (pinSource) {
      case "address":
        return `Pin placed at ${pickedLabel}. Save to keep it.`;
      case "manual":
        return "You set this pin by hand.";
      case "saved":
        return "The pin follows your address. If it is off, use Edit pinpoint.";
      case "none":
        return "Search your property above and the pin is placed for you.";
    }
  })();

  return (
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

      <AddressFinder
        initial={savedAddress}
        disabled={pending}
        errors={{
          addressLine1: state.errors?.addressLine1,
          addressLine2: state.errors?.addressLine2,
          postalCode: state.errors?.postalCode,
          city: state.errors?.city,
          country: state.errors?.country,
        }}
        onPick={onPickAddress}
        onEdit={onEditAddress}
        onModeChange={setFinderMode}
      />

      <Field data-invalid={!!state.errors?.lat || !!state.errors?.lon}>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <FieldLabel>Map pin</FieldLabel>
            <FieldDescription aria-live="polite">{pinStatus}</FieldDescription>
          </div>
          {!editingPin && (
            <div className="flex shrink-0 gap-2">
              {pinManual && (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={followAddress}>
                  <MapPinIcon />
                  Follow the address
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setConfirmEdit(true)}
              >
                <LocateFixedIcon />
                Edit pinpoint
              </Button>
            </div>
          )}
        </div>

        {/*
          Empty rather than "0" when there is no pin: the save schema reads
          a blank as "not answered" and says so in the host's own words,
          where a literal 0,0 would look like a deliberate answer.
        */}
        <input type="hidden" name="lat" value={pinned ? String(lat) : ""} />
        <input type="hidden" name="lon" value={pinned ? String(lon) : ""} />
        {pinManual && <input type="hidden" name="pinSetManually" value="on" />}

        {editingPin && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="flex-1">
              Drag the pin, or click the map, to where guests should arrive. You are overriding
              your address — guests navigate to this exact spot.
            </p>
            <Button type="button" size="sm" onClick={() => setEditingPin(false)}>
              <CheckIcon />
              Done
            </Button>
          </div>
        )}

        <div
          className={cn(
            "relative h-80 overflow-hidden rounded-lg border",
            editingPin && "ring-2 ring-amber-500/50",
          )}
        >
          <Map
            ref={mapRef}
            center={pinned ? [lon!, lat!] : UNPINNED_CENTER}
            zoom={pinned ? PINNED_ZOOM : UNPINNED_ZOOM}
          >
            {editingPin && (
              <PinPlacer onPick={placedByHand} />
            )}
            {pinned && (
              <MapMarker
                longitude={lon!}
                latitude={lat!}
                draggable={editingPin}
                onDragEnd={({ lng, lat: newLat }) => placedByHand(lng, newLat)}
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
            What the map is showing while the address is being changed. Not a
            blocking overlay: the map has deliberately not moved, and still
            shows the address that is saved until the host picks a new one.
          */}
          {pinned && (finderMode === "search" || locate === "locating" || locate === "approximate") && (
            <div
              role="status"
              className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm"
            >
              {locate === "locating" ? (
                <>
                  <Spinner className="size-3.5 shrink-0" />
                  Placing your typed address…
                </>
              ) : locate === "approximate" ? (
                <>
                  <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  Approximate location. Check the pin, or use Edit pinpoint.
                </>
              ) : (
                <>
                  <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  Showing your current address. The map moves when you pick a result.
                </>
              )}
            </div>
          )}

          {/*
            pointer-events-none: in edit mode the prompt says "click the map".
            Only the "Set pin manually" button takes clicks.
          */}
          {!pinned && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 backdrop-blur-[2px]">
              <div
                className={cn(
                  "flex size-11 items-center justify-center rounded-full bg-background/80 ring-1",
                  locate === "not-found" && !editingPin ? "ring-destructive/50" : "ring-border",
                )}
              >
                <MapPinIcon
                  className={cn(
                    "size-5",
                    locate === "not-found" && !editingPin ? "text-destructive" : "text-muted-foreground",
                  )}
                />
              </div>
              <p className="font-medium text-sm">
                {locate === "not-found" && !editingPin ? "Set the pin manually" : "No pin yet"}
              </p>
              <p className="max-w-64 text-center text-muted-foreground text-xs">
                {editingPin
                  ? "Click where guests should arrive. You can drag it afterwards."
                  : locate === "not-found"
                    ? "Your typed address could not be found on the map, so place the pin yourself."
                    : "Search your property above and the pin is placed for you."}
              </p>
              {!editingPin && locate === "not-found" && (
                <Button
                  type="button"
                  size="sm"
                  className="pointer-events-auto mt-1"
                  onClick={() => setConfirmEdit(true)}
                  disabled={pending}
                >
                  <LocateFixedIcon />
                  Set pin manually
                </Button>
              )}
            </div>
          )}
        </div>
        {locate === "not-found" && !pinned && (
          <FieldError>
            This address cannot be placed on the map automatically. Set the pin manually before
            saving.
          </FieldError>
        )}
        {(state.errors?.lat || state.errors?.lon) && !(locate === "not-found" && !pinned) && (
          <FieldError>{(state.errors.lat ?? state.errors.lon)![0]}</FieldError>
        )}
      </Field>

      <AlertDialog open={confirmEdit} onOpenChange={setConfirmEdit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Place the pin yourself?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>
                  The pin normally follows your address. Only move it if the map has your
                  property in the wrong spot.
                </p>
                <p>
                  Guests use this pin for directions. If you place it by hand you do so at your
                  own risk: a wrong pin can send guests to the wrong door, and you are
                  responsible for its accuracy.
                </p>
                <p>
                  Once you set it, the pin stays where you put it, even when you edit the address.
                  &ldquo;Follow the address&rdquo; undoes this at any time.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setEditingPin(true)}>
              I understand, edit pin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Field data-invalid={!!state.errors?.timezone}>
        <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
        <Select
          name="timezone"
          value={timezone}
          onValueChange={(v) => {
            setTimezone(v);
            markDirty();
          }}
          disabled={pending}
        >
          <SelectTrigger id="timezone" className="w-full sm:w-80" aria-invalid={!!state.errors?.timezone}>
            <SelectValue placeholder="Choose a timezone" />
          </SelectTrigger>
          <SelectContent>
            {/* A zone saved before this list existed stays selectable rather than vanishing. */}
            {timezone && !EU_TIMEZONES.has(timezone) && (
              <SelectGroup>
                <SelectLabel>Current</SelectLabel>
                <SelectItem value={timezone}>{timezone}</SelectItem>
              </SelectGroup>
            )}
            {EU_TIMEZONE_GROUPS.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.zones.map((z) => (
                  <SelectItem key={z.value} value={z.value}>
                    {z.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          Decides which date a booking falls on for your property. Pick the city nearest you.
        </FieldDescription>
        {state.errors?.timezone && <FieldError>{state.errors.timezone[0]}</FieldError>}
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
          <p className="flex items-center gap-1.5 font-medium text-sm">
            Nearby
            <InfoTip label="Nearby places">
              <p className="font-medium text-foreground!">What to add here</p>
              <p>
                Three to six places your guests will actually go: the beach, a favourite
                restaurant, the nearest train or bus stop, a landmark, a supermarket.
              </p>
              <p>
                Give each a distance guests can picture — “300 m” or “5 min walk” — and pick the
                icon that fits. Use real names, so guests can look them up.
              </p>
              <p>Skip anything more than a short drive away.</p>
            </InfoTip>
          </p>
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
  );
}
