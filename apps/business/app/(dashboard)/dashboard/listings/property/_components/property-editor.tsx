"use client";

import * as React from "react";
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
import { allSectionStatuses, completedCount } from "../_lib/completion";
import type { AmenityCatalogEntry } from "../_lib/query";
import type { PropertyEditorData, SectionId } from "../_lib/types";
import { PublishToggle } from "./publish-toggle";
import { SectionRail } from "./section-rail";
import { IdentitySection } from "./sections/identity";
import { LegalSection } from "./sections/legal";
import { LocationSection } from "./sections/location";
import { OverviewSection } from "./sections/overview";
import { PhotosSection } from "./sections/photos";
import { PoliciesSection } from "./sections/policies";

interface PropertyEditorProps {
  data: PropertyEditorData;
  amenities: AmenityCatalogEntry[];
  publicBaseUrl: string;
}

export function PropertyEditor({ data, amenities, publicBaseUrl }: PropertyEditorProps) {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <SectionRail
        statuses={statuses}
        active={active}
        completed={completed}
        onSelect={requestSection}
        publicUrl={`${publicBaseUrl}/p/${data.property.slug}`}
        publishSlot={<PublishToggle data={data} statuses={statuses} />}
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
