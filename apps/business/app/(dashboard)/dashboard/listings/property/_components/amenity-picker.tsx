"use client";

import * as React from "react";
import { CheckIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { AmenityCatalogEntry } from "../_lib/query";

interface AmenityPickerProps {
  amenities: AmenityCatalogEntry[];
  selectedIds: string[];
  disabled?: boolean;
  /** Tile clicks are buttons, not inputs, so the form's onChange never sees them. */
  onChange?: () => void;
}

const ALL = "__all";
const SELECTED = "__selected";

const KNOWN_ICONS = new Set<string>(iconNames);

/** The catalogue stores PascalCase ("BedDouble") or kebab ("bed-double"); lucide/dynamic wants kebab. */
function toIconName(name: string): IconName | null {
  const kebab = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return KNOWN_ICONS.has(kebab) ? (kebab as IconName) : null;
}

function AmenityIcon({ name }: { name: string }) {
  const icon = toIconName(name);
  if (!icon) return <SparklesIcon className="size-4" />;
  return <DynamicIcon name={icon} className="size-4" fallback={() => <span className="size-4" />} />;
}

/**
 * A searchable, filterable grid rather than one long checkbox list: the
 * catalogue runs to dozens of entries, and a host scanning for "sauna" should
 * not have to read every category to find it — or to see what they already
 * picked.
 *
 * The selection is mirrored into hidden inputs named `amenityIds`, which is
 * what `formData.getAll("amenityIds")` in saveOverview reads.
 */
export function AmenityPicker({ amenities, selectedIds, disabled, onChange }: AmenityPickerProps) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set(selectedIds));
  const [queryText, setQueryText] = React.useState("");
  const [filter, setFilter] = React.useState<string>(ALL);

  const categories = React.useMemo(() => {
    const groups = new Map<string, AmenityCatalogEntry[]>();
    for (const a of amenities) {
      const list = groups.get(a.category) ?? [];
      list.push(a);
      groups.set(a.category, list);
    }
    return [...groups.entries()];
  }, [amenities]);

  const q = queryText.trim().toLowerCase();

  // Search always spans the whole catalogue: a host typing "parking" while a
  // category is open expects to find it, not an empty grid.
  const visible = React.useMemo(() => {
    return categories
      .map(([category, items]) => {
        const matches = items.filter((a) => {
          if (q) return a.label.toLowerCase().includes(q) || category.toLowerCase().includes(q);
          if (filter === SELECTED) return selected.has(a.id);
          if (filter !== ALL) return category === filter;
          return true;
        });
        return [category, matches] as const;
      })
      .filter(([, items]) => items.length > 0);
  }, [categories, q, filter, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    onChange?.();
  }

  function clearAll() {
    setSelected(new Set());
    onChange?.();
  }

  const chips: { value: string; label: string; count: string }[] = [
    { value: ALL, label: "All", count: String(amenities.length) },
    { value: SELECTED, label: "Selected", count: String(selected.size) },
    ...categories.map(([category, items]) => ({
      value: category,
      label: category,
      count: `${items.filter((a) => selected.has(a.id)).length}/${items.length}`,
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="amenityIds" value={id} />
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search amenities"
            placeholder="Search amenities"
            value={queryText}
            onChange={(e) => {
              // Typing a filter is not an edit to the listing: keep it from
              // reaching SectionForm's onChange and flagging unsaved changes.
              e.stopPropagation();
              setQueryText(e.target.value);
            }}
            disabled={disabled}
          />
          {queryText && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQueryText("")}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>

        <p className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
          {selected.size} selected
        </p>
        {selected.size > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={clearAll}
            disabled={disabled}
          >
            Clear all
          </Button>
        )}
      </div>

      <div role="group" aria-label="Filter amenities" className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const active = !q && filter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setFilter(chip.value);
                setQueryText("");
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
            >
              {chip.label}
              <span className={cn("tabular-nums", active ? "opacity-70" : "opacity-60")}>{chip.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex max-h-[28rem] flex-col gap-4 overflow-y-auto rounded-lg border p-3">
        {visible.length === 0 && (
          <p className="py-8 text-center text-muted-foreground text-sm">
            {q
              ? `No amenities match “${queryText.trim()}”.`
              : filter === SELECTED
                ? "Nothing selected yet."
                : "No amenities in this category."}
          </p>
        )}

        {visible.map(([category, items]) => (
          <section key={category} className="flex flex-col gap-2">
            {/* A single category filter already says which category this is. */}
            {(filter === ALL || filter === SELECTED || q) && (
              <h4 className="text-muted-foreground text-xs uppercase tracking-wide">{category}</h4>
            )}
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => {
                const on = selected.has(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => toggle(a.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      on
                        ? "border-primary bg-primary/5 text-foreground dark:bg-primary/10"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <AmenityIcon name={a.icon} />
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    <CheckIcon className={cn("size-4 shrink-0 text-primary", !on && "invisible")} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
