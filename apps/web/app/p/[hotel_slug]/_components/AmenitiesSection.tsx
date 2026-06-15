"use client";

import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as Icons from "lucide-react";
import FocusOverlay from "@/components/plug-in/FocusOverlay";
import type { DbAmenityCategory } from "./constants";
import { AMENITIES_PREVIEW, PILLS_PER_ROW } from "./constants";

// Maps icon name strings stored in the DB to Lucide components.
// Handles both PascalCase ("BedDouble") and kebab-case ("bed-double").
function toPascalCase(s: string) {
  return s.replace(/(^\w|-\w)/g, (m) => m.replace("-", "").toUpperCase());
}

function getIcon(name: string): LucideIcon {
  const pascal = toPascalCase(name);
  const icon = (Icons as Record<string, unknown>)[pascal] ?? (Icons as Record<string, unknown>)[name];
  return (typeof icon === "function" ? icon : Sparkles) as LucideIcon;
}

export function AmenitiesSection({
  hotelName,
  amenityCategories,
}: {
  hotelName: string;
  amenityCategories: DbAmenityCategory[];
}) {
  const [overlayOpen, setOverlayOpen] = useState(false);

  const allItems = amenityCategories.flatMap((c) => c.items);
  const overflow = allItems.length > AMENITIES_PREVIEW;
  const visible = allItems.slice(0, AMENITIES_PREVIEW);
  const remaining = allItems.length - AMENITIES_PREVIEW;

  const rows: (typeof allItems)[] = [];
  for (let i = 0; i < visible.length; i += PILLS_PER_ROW) {
    rows.push(visible.slice(i, i + PILLS_PER_ROW));
  }

  if (allItems.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-3">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-3">
            {row.map(({ icon, label }) => {
              const Icon = getIcon(icon);
              return (
                <div
                  key={label}
                  className="flex items-center gap-3 px-4 py-4 rounded-xl border border-white/8 bg-white/3 flex-1 min-w-0"
                >
                  <Icon className="size-5 text-white/45 shrink-0" strokeWidth={1.5} />
                  <span className="text-sm text-white/70 truncate">{label}</span>
                </div>
              );
            })}
          </div>
        ))}

        {overflow && (
          <button
            type="button"
            onClick={() => setOverlayOpen(true)}
            className="mt-1 self-center text-xs uppercase tracking-[0.18em] text-white/50 hover:text-white/75 transition-colors"
          >
            +{remaining} more amenities
          </button>
        )}
      </div>

      <FocusOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)}>
        <div
          className="bg-[#0f0f0e] border border-white/[0.07] rounded-2xl flex flex-col overflow-hidden"
          style={{ width: "min(640px, 92vw)", maxHeight: "82vh" }}
        >
          <div className="flex items-center justify-between px-8 pt-7 pb-6 shrink-0">
            <h2 className="font-serif text-2xl text-white tracking-tight">All Amenities</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOverlayOpen(false)}
              className="size-7 flex items-center justify-center text-white/25 hover:text-white/55 transition-colors"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-8 [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-thumb]:bg-white/10]">
            {amenityCategories.map((category, ci) => (
              <div key={category.label}>
                {ci > 0 && <div className="border-t border-white/5.5" />}
                <div className="py-6">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-white/45 mb-5">
                    {category.label}
                  </p>
                  <div className="grid grid-cols-3 gap-x-6 gap-y-4">
                    {category.items.map(({ icon, label }) => {
                      const Icon = getIcon(icon);
                      return (
                        <div key={label} className="flex items-center gap-2.5 min-w-0">
                          <Icon className="size-[15px] text-white/22 shrink-0" strokeWidth={1.4} />
                          <span className="text-[13px] text-white/60 truncate">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </FocusOverlay>
    </>
  );
}
