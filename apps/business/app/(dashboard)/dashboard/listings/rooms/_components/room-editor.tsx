"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
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
import { setRoomPublished } from "../_lib/actions";
import { allSectionStatuses, completedCount } from "../_lib/completion";
import {
  ROOM_SECTION_IDS,
  ROOM_SECTION_LABELS,
  type RoomEditorData,
  type RoomSectionId,
} from "../_lib/types";
import { AmenitiesSection } from "./sections/amenities";
import { IdentitySection } from "./sections/identity";
import { PhotosSection } from "./sections/photos";
import { RatesSection } from "./sections/rates";
import { SpaceSection } from "./sections/space";

const SECTIONS = ROOM_SECTION_IDS.map((id) => ({ id, label: ROOM_SECTION_LABELS[id] }));

/**
 * The Property editor's shell, for one room type: the same rail, the same
 * save model and the same publish gate.
 *
 * Identity, Space and Amenities save from the shared footer; Photos save per
 * upload; each rate saves from its own Sheet. The Sheet's `?rate=` param is
 * the one piece of state in the URL, so a rate can be linked to — opening the
 * editor with it lands on Rates.
 */
export function RoomEditor({ data }: { data: RoomEditorData }) {
  const searchParams = useSearchParams();
  const [active, setActive] = React.useState<RoomSectionId>(
    searchParams.get("rate") ? "rates" : "identity",
  );
  const [dirty, setDirty] = React.useState(false);
  const [pendingSection, setPendingSection] = React.useState<RoomSectionId | null>(null);

  const statuses = React.useMemo(() => allSectionStatuses(data), [data]);
  const completed = React.useMemo(() => completedCount(data), [data]);
  const incomplete = ROOM_SECTION_IDS.filter((id) => !statuses[id].complete).map(
    (id) => ROOM_SECTION_LABELS[id],
  );

  // Section switches ask first (below). Leaving the page altogether — a tab
  // close, a reload, a typed URL — gets the browser's own prompt.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function requestSection(next: RoomSectionId) {
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
        sections={SECTIONS}
        statuses={statuses}
        active={active}
        completed={completed}
        onSelect={requestSection}
        publishSlot={
          <PublishToggle
            published={data.room.status === "published"}
            incomplete={incomplete}
            setPublished={(next) => setRoomPublished(data.room.id, next)}
            eventPrefix="room"
            copy={{
              published: {
                title: "Room type is live",
                description: "Guests can see and book it on your listing.",
              },
              unpublished: {
                title: "Room type is hidden",
                description: "Guests can no longer see or book it.",
              },
            }}
          />
        }
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {active === "identity" && <IdentitySection key="identity" {...sectionProps} />}
        {active === "space" && <SpaceSection key="space" {...sectionProps} />}
        {active === "photos" && <PhotosSection key="photos" {...sectionProps} />}
        {active === "amenities" && <AmenitiesSection key="amenities" {...sectionProps} />}
        {active === "rates" && <RatesSection key="rates" {...sectionProps} />}
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
