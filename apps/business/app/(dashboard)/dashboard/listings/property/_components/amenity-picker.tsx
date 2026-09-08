"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { AmenityCatalogEntry } from "../_lib/query";

interface AmenityPickerProps {
  amenities: AmenityCatalogEntry[];
  selectedIds: string[];
  disabled?: boolean;
}

/**
 * Radix Checkbox renders a button, not an <input>, so it posts nothing on its
 * own. The selection is mirrored into hidden inputs named `amenityIds`, which
 * is what `formData.getAll("amenityIds")` in saveOverview reads.
 */
export function AmenityPicker({ amenities, selectedIds, disabled }: AmenityPickerProps) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set(selectedIds));

  const byCategory = React.useMemo(() => {
    const groups = new Map<string, AmenityCatalogEntry[]>();
    for (const a of amenities) {
      const list = groups.get(a.category) ?? [];
      list.push(a);
      groups.set(a.category, list);
    }
    return [...groups.entries()];
  }, [amenities]);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="amenityIds" value={id} />
      ))}

      {byCategory.map(([category, items]) => (
        <fieldset key={category} className="flex flex-col gap-2">
          <legend className="text-muted-foreground text-xs uppercase tracking-wide">
            {category}
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <Checkbox
                  id={`amenity-${a.id}`}
                  checked={selected.has(a.id)}
                  disabled={disabled}
                  onCheckedChange={(c) => toggle(a.id, c === true)}
                />
                <Label htmlFor={`amenity-${a.id}`} className="font-normal text-sm">
                  {a.label}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
