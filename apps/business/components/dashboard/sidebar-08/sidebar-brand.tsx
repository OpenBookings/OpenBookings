"use client";

import { useState } from "react";

import type { PropertyBrand } from "@/lib/property-brand";
import { SidebarMenuButton } from "@/components/ui/sidebar";

const OPENBOOKINGS_MARK = "https://cdn.openbookings.co/Public/Openbookings-logo-v2.png";

/**
 * The sidebar header link, in one of two states.
 *
 * Default — the OpenBookings mark beside the wordmark and "Property
 * dashboard". This is what a host sees before they have uploaded a logo, and
 * what they fall back to if their logo ever stops loading.
 *
 * Co-branded — the OpenBookings mark, a divider, then the property's own logo
 * given the rest of the row. The property name is deliberately NOT repeated
 * as text: a property logo is nearly always a wordmark that already says the
 * name, and printing it twice only cost the logo the width it needed to be
 * legible. The name still reaches a screen reader through the logo's alt.
 *
 * The property logo is only ever the *second* mark: OpenBookings stays in the
 * header of its own dashboard, and a host who recognises their own logo needs
 * no help telling which of the two is theirs.
 */
export function SidebarBrand({ brand }: { brand?: PropertyBrand | null }) {
  // A logo row whose CDN object has gone missing would otherwise leave a
  // broken image permanently wedged in the chrome. Falling back is quieter
  // than a placeholder, and the default state is a complete header already.
  const [logoFailed, setLogoFailed] = useState(false);
  const logoUrl = logoFailed ? null : (brand?.logoUrl ?? null);
  const coBranded = Boolean(logoUrl);

  return (
    <SidebarMenuButton
      size="lg"
      asChild
      className="group-data-[collapsible=icon]:hidden"
    >
      <a href="/dashboard">
        <img
          src={OPENBOOKINGS_MARK}
          // Decorative in the co-branded state, where it is one half of a
          // lockup the property logo's alt already names; decorative in the
          // default state too, where the adjacent text reads "OpenBookings".
          alt=""
          // Height pinned, width left to the aspect ratio: the mark is 4:3,
          // so sizing it by width would render it 32x24 and leave it shorter
          // than whatever it is paired with.
          //
          // Co-branded it drops to h-6 and takes an equal share of the row.
          // Equal *height* is not equal weight: this mark is a single dense
          // glyph that fills its box, while a property logo is typically a
          // stacked wordmark whose lettering occupies a fraction of its own.
          // Matched at h-8 the mark shouts over the logo it is introducing,
          // so the platform mark is the one that yields.
          className={`pointer-events-none w-auto rounded-lg object-contain select-none ${
            coBranded ? "h-6 min-w-0 flex-1" : "h-8 shrink-0"
          }`}
          draggable={false}
        />
        {coBranded ? (
          <>
            <span aria-hidden className="h-6 w-px shrink-0 bg-sidebar-border" />
            <img
              src={logoUrl as string}
              alt={brand?.name ?? ""}
              onError={() => setLogoFailed(true)}
              // The other equal share of the row, sized and centred exactly
              // like the mark above. Height-constrained and width-free
              // because property logos are usually wordmarks, and a box that
              // caps their width letterboxes them into an illegible smudge.
              className="pointer-events-none h-8 w-auto min-w-0 flex-1 object-contain select-none"
              draggable={false}
            />
          </>
        ) : (
          <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">OpenBookings</span>
            <span className="truncate text-xs text-muted-foreground">
              Property dashboard
            </span>
          </div>
        )}
      </a>
    </SidebarMenuButton>
  );
}
