"use client";

import * as React from "react";
import { BuildingIcon, CheckIcon, MapPinIcon, PencilIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { searchProperty, type AddressCandidate, type AddressFields } from "../_lib/address-lookup";
import { COUNTRIES, countryName } from "../_lib/countries";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_API_KEY ?? "";
const SEARCH_DEBOUNCE_MS = 400;

export type AddressValue = AddressFields & { addressLine2: string };
export type FinderMode = "view" | "search" | "edit";

interface AddressFinderProps {
  initial: AddressValue;
  disabled?: boolean;
  errors?: Partial<Record<keyof AddressValue, string[]>>;
  /** The host picked a search result: a new location, so the pin goes there. */
  onPick: (candidate: AddressCandidate) => void;
  /** The host edited an address line; the pin follows unless set by hand. */
  onEdit: (address: AddressValue) => void;
  onModeChange?: (mode: FinderMode) => void;
}

type Search =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: AddressCandidate[] }
  | { status: "error" };

const LINE_LABELS: Record<keyof AddressFields, string> = {
  addressLine1: "street and house number",
  postalCode: "postal code",
  city: "city",
  country: "country",
};

function hasAddress(a: AddressValue) {
  return a.addressLine1.trim() !== "" && a.city.trim() !== "";
}

/**
 * The property's address, found by name first. A host knows what their
 * property is called long before they know how a geocoder spells their
 * street — and a named place often has no house number at all.
 *
 * Three modes:
 * - view: the address as it stands, with "Edit address" and "Search again".
 * - search: type the property's name, pick it; the address fills in and the
 *   pin lands on the building. Typing here is not an edit to the listing.
 * - edit: every address line, editable. Opened by "Edit address", by a
 *   failed save, or by a pick that could not fill every line.
 *
 * The form posts the same five fields in every mode: as hidden inputs while
 * viewing or searching, as the inputs themselves while editing.
 */
export function AddressFinder({ initial, disabled, errors, onPick, onEdit, onModeChange }: AddressFinderProps) {
  const [address, setAddress] = React.useState<AddressValue>(initial);
  const [mode, setModeState] = React.useState<FinderMode>(hasAddress(initial) ? "view" : "search");
  // Lines the last pick could not fill; highlighted until the host fills them.
  const [missing, setMissing] = React.useState<(keyof AddressFields)[]>([]);
  const [pickedName, setPickedName] = React.useState<string | null>(null);

  const [queryText, setQueryText] = React.useState("");
  const [search, setSearch] = React.useState<Search>({ status: "idle" });

  const onModeChangeRef = React.useRef(onModeChange);
  React.useEffect(() => {
    onModeChangeRef.current = onModeChange;
  });

  function setMode(next: FinderMode) {
    setModeState(next);
    onModeChangeRef.current?.(next);
  }

  // Report the starting mode once, so the map can label itself from the start.
  React.useEffect(() => {
    onModeChangeRef.current?.(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A save the server refused for an address line: show the lines, so the
  // host can see and fix the one it named.
  const addressErrors = (["addressLine1", "addressLine2", "postalCode", "city", "country"] as const)
    .map((k) => errors?.[k]?.[0])
    .filter(Boolean) as string[];
  const hasAddressErrors = addressErrors.length > 0;
  React.useEffect(() => {
    if (!hasAddressErrors) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState("edit");
    onModeChangeRef.current?.("edit");
  }, [hasAddressErrors, errors]);

  React.useEffect(() => {
    if (mode !== "search" || queryText.trim().length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearch({ status: "loading" });
      try {
        const results = await searchProperty(queryText, MAPTILER_KEY, controller.signal);
        if (!controller.signal.aborted) setSearch({ status: "done", results });
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Property search failed:", err);
        setSearch({ status: "error" });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, queryText]);

  function pick(c: AddressCandidate) {
    const next: AddressValue = {
      addressLine1: c.addressLine1,
      // A new location's second line would belong to the old one.
      addressLine2: "",
      postalCode: c.postalCode,
      city: c.city,
      country: c.country,
    };
    setAddress(next);
    setMissing(c.missing);
    setPickedName(c.name);
    setQueryText("");
    setSearch({ status: "idle" });
    setMode(c.missing.length > 0 ? "edit" : "view");
    onPick(c);
  }

  function editLine<K extends keyof AddressValue>(key: K, value: AddressValue[K]) {
    const next = { ...address, [key]: value };
    setAddress(next);
    if (value) setMissing((m) => m.filter((x) => x !== key));
    onEdit(next);
  }

  const hidden = mode !== "edit" && (
    <>
      <input type="hidden" name="addressLine1" value={address.addressLine1} />
      <input type="hidden" name="addressLine2" value={address.addressLine2} />
      <input type="hidden" name="postalCode" value={address.postalCode} />
      <input type="hidden" name="city" value={address.city} />
      <input type="hidden" name="country" value={address.country} />
    </>
  );

  return (
    <Field data-invalid={hasAddressErrors}>
      <FieldLabel>Address</FieldLabel>
      {hidden}

      {mode === "view" && (
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <MapPinIcon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 text-sm">
              <p className="font-medium">{address.addressLine1}</p>
              {address.addressLine2 && <p>{address.addressLine2}</p>}
              <p className="text-muted-foreground">
                {[address.postalCode, address.city].filter(Boolean).join(" ")}, {countryName(address.country)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setMode("edit")}>
              <PencilIcon />
              Edit address
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setMode("search")}>
              <SearchIcon />
              Search again
            </Button>
          </div>
        </div>
      )}

      {mode === "search" && (
        // Stops the search box's change events reaching SectionForm's
        // onChange: looking a property up is not editing the listing.
        <div className="flex flex-col gap-3 rounded-lg border p-4" onChange={(e) => e.stopPropagation()}>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search your property by name"
              placeholder="Search your property by name, e.g. Terme di Saturnia"
              value={queryText}
              onChange={(e) => {
                setQueryText(e.target.value);
                if (e.target.value.trim().length < 3) setSearch({ status: "idle" });
              }}
              disabled={disabled}
            />
            {queryText && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear search"
                  onClick={() => {
                    setQueryText("");
                    setSearch({ status: "idle" });
                  }}
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          <SearchResults search={search} onPick={pick} disabled={disabled} />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <button
              type="button"
              className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
              onClick={() => setMode("edit")}
              disabled={disabled}
            >
              Cannot find it? Enter the address yourself
            </button>
            {hasAddress(address) && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("view")} disabled={disabled}>
                Keep current address
              </Button>
            )}
          </div>
        </div>
      )}

      {mode === "edit" && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          {missing.length > 0 && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">
              We filled in what we could{pickedName ? ` for ${pickedName}` : ""}. Add the{" "}
              {missing.map((m) => LINE_LABELS[m]).join(" and ")} below.
            </p>
          )}

          <AddressLine
            id="addressLine1"
            label="Street and house number"
            value={address.addressLine1}
            onChange={(v) => editLine("addressLine1", v)}
            placeholder="Via delle Terme 1, or Località Follonata"
            autoComplete="address-line1"
            highlight={missing.includes("addressLine1")}
            error={errors?.addressLine1?.[0]}
            disabled={disabled}
          />
          <AddressLine
            id="addressLine2"
            label="Address line 2"
            value={address.addressLine2}
            onChange={(v) => editLine("addressLine2", v)}
            placeholder="Optional: building, floor, or unit"
            autoComplete="address-line2"
            error={errors?.addressLine2?.[0]}
            disabled={disabled}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr_12rem]">
            <AddressLine
              id="postalCode"
              label="Postal code"
              value={address.postalCode}
              onChange={(v) => editLine("postalCode", v)}
              autoComplete="postal-code"
              highlight={missing.includes("postalCode")}
              error={errors?.postalCode?.[0]}
              disabled={disabled}
            />
            <AddressLine
              id="city"
              label="City"
              value={address.city}
              onChange={(v) => editLine("city", v)}
              autoComplete="address-level2"
              highlight={missing.includes("city")}
              error={errors?.city?.[0]}
              disabled={disabled}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="country" className="text-muted-foreground text-xs">Country</label>
              <Select
                name="country"
                value={address.country}
                onValueChange={(v) => editLine("country", v)}
                disabled={disabled}
              >
                <SelectTrigger id="country" className="w-full" aria-invalid={!!errors?.country}>
                  <SelectValue placeholder="Country" />
                </SelectTrigger>
                <SelectContent>
                  {/* A country saved before this list existed stays selectable. */}
                  {address.country && !COUNTRIES.some((c) => c.code === address.country) && (
                    <SelectItem value={address.country}>{address.country}</SelectItem>
                  )}
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors?.country && <FieldError>{errors.country[0]}</FieldError>}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <FieldDescription className="flex-1">
              The map pin follows these lines as you type, unless you set it by hand.
            </FieldDescription>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("search")} disabled={disabled}>
                <SearchIcon />
                Search by name
              </Button>
              {hasAddress(address) && (
                <Button type="button" variant="outline" size="sm" onClick={() => setMode("view")} disabled={disabled}>
                  <CheckIcon />
                  Done
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {mode !== "edit" && addressErrors.map((e) => <FieldError key={e}>{e}</FieldError>)}
    </Field>
  );
}

function AddressLine({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  highlight,
  error,
  disabled,
}: {
  id: keyof AddressValue;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  highlight?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-muted-foreground text-xs">{label}</label>
      <Input
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={!!error}
        className={cn(highlight && "border-amber-500 ring-2 ring-amber-500/30")}
      />
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function SearchResults({
  search,
  onPick,
  disabled,
}: {
  search: Search;
  onPick: (c: AddressCandidate) => void;
  disabled?: boolean;
}) {
  if (search.status === "idle") {
    return (
      <p className="text-muted-foreground text-sm">
        Type your property&apos;s name. Picking it fills in the address and places the pin.
      </p>
    );
  }
  if (search.status === "loading") {
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
        <Spinner className="size-3.5" /> Searching…
      </p>
    );
  }
  if (search.status === "error") {
    return (
      <p className="text-destructive text-sm" role="alert">
        The search is not responding. Try again in a moment, or enter the address yourself.
      </p>
    );
  }
  if (search.results.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Nothing found by that name. Try another spelling, or enter the address yourself.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5" aria-label={`${search.results.length} results`}>
      {search.results.map((c) => {
        // The rest of the label after the name, so the name is not said twice.
        const detail = c.label.startsWith(c.name) ? c.label.slice(c.name.length).replace(/^,\s*/, "") : c.label;
        return (
          <li key={c.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(c)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                "hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              )}
            >
              <BuildingIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                {detail && <span className="block truncate text-muted-foreground text-xs">{detail}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs group-hover:text-foreground">
                <CheckIcon className="size-3.5" /> This one
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
