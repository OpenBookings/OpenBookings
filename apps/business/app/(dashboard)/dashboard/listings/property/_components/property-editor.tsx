"use client";

import * as React from "react";
import dynamic from "next/dynamic";
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
import { PublishToggle } from "../../_components/publish-toggle";
import { SectionRail } from "../../_components/section-rail";
import { setPublished } from "../_lib/actions";
import { allSectionStatuses, completedCount } from "../_lib/completion";
import type { AmenityCatalogEntry } from "../_lib/query";
import { SECTION_IDS, SECTION_LABELS, type PropertyEditorData, type SectionId } from "../_lib/types";
import { IdentitySection } from "./sections/identity";
import { LegalSection } from "./sections/legal";
import { OverviewSection } from "./sections/overview";
import { PhotosSection } from "./sections/photos";
import { PoliciesSection } from "./sections/policies";

// The location section pulls in maplibre-gl, which no other section needs, so
// it is fetched when the tab is first opened.
const LocationSection = dynamic(() => import("./sections/location").then((m) => m.LocationSection), {
  ssr: false,
  loading: () => <div className="h-96 animate-pulse rounded-xl bg-muted" aria-hidden />,
});

interface PropertyEditorProps {
  data: PropertyEditorData;
  amenities: AmenityCatalogEntry[];
}

export function PropertyEditor({ data, amenities }: PropertyEditorProps) {
  const [active, setActive] = React.useState<SectionId>("identity");
  const [dirty, setDirty] = React.useState(false);
  const [pendingSection, setPendingSection] = React.useState<SectionId | null>(null);

  const statuses = React.useMemo(() => allSectionStatuses(data), [data]);
  const completed = React.useMemo(() => completedCount(data), [data]);

  /**
   * No autosave. This screen writes the host's public shopfront, so a silent
   * write is the wrong default — but leaving without warning is worse, so
   * navigation with unsaved work asks first.
   */
  function requestSection(next: SectionId) {
    if (next === active) return;
    if (dirty) {
      setPendingSection(next);
      return;
    }
    setActive(next);
  }

  function confirmDiscard() {
    if (pendingSection) setActive(pendingSection);
    setPendingSection(null);
    setDirty(false);
  }

  const sectionProps = { data, onDirtyChange: setDirty };
  const sections = SECTION_IDS.map((id) => ({ id, label: SECTION_LABELS[id] }));
  const incomplete = SECTION_IDS.filter((id) => !statuses[id].complete).map(
    (id) => SECTION_LABELS[id],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <SectionRail
        sections={sections}
        statuses={statuses}
        active={active}
        completed={completed}
        onSelect={requestSection}
        publishSlot={
          <PublishToggle
            published={data.property.isActive}
            incomplete={incomplete}
            setPublished={(next) => setPublished(data.property.id, next)}
            eventPrefix="property"
            copy={{
              published: {
                title: "Your listing is live",
                description: "Guests can find and book it now.",
              },
              unpublished: {
                title: "Your listing is hidden",
                description: "Guests can no longer see or book it.",
              },
            }}
          />
        }
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {active === "identity" && <IdentitySection key="identity" {...sectionProps} />}
        {active === "photos" && <PhotosSection key="photos" {...sectionProps} />}
        {active === "overview" && (
          <OverviewSection key="overview" {...sectionProps} amenities={amenities} />
        )}
        {active === "policies" && <PoliciesSection key="policies" {...sectionProps} />}
        {active === "location" && <LocationSection key="location" {...sectionProps} />}
        {active === "legal" && <LegalSection key="legal" {...sectionProps} />}
      </div>

      <AlertDialog open={pendingSection !== null} onOpenChange={(o) => !o && setPendingSection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have edits in this section that have not been saved. Leaving now loses them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
