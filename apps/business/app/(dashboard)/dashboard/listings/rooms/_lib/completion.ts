import type { SectionStatus } from "../../_lib/editor";
import { LIMITS } from "./constants";
import { totalBeds } from "./derive";
import { ROOM_SECTION_IDS, type RoomEditorData, type RoomSectionId } from "./types";

export type { SectionStatus };

const length = (v: string | null | undefined) => v?.trim().length ?? 0;

/**
 * A section's required fields, as label → satisfied predicate, in the same
 * shape as the Property editor's rules. The limits come from LIMITS, which the
 * save schemas also read, so the rail and the save cannot disagree.
 */
type Rule = [label: string, satisfied: (d: RoomEditorData) => boolean];

const RULES: Record<RoomSectionId, Rule[]> = {
  identity: [
    [
      "Room name",
      (d) => length(d.room.name) >= LIMITS.roomName.min && length(d.room.name) <= LIMITS.roomName.max,
    ],
    [
      `Description of ${LIMITS.roomDescription.min}–${LIMITS.roomDescription.max} characters`,
      (d) =>
        length(d.room.description) >= LIMITS.roomDescription.min &&
        length(d.room.description) <= LIMITS.roomDescription.max,
    ],
  ],
  space: [
    ["Size", (d) => d.room.sizeM2 !== null && d.room.sizeM2 > 0],
    ["At least one bed", (d) => totalBeds(d.room.beds) > 0],
    [
      "Maximum adults",
      (d) => d.room.maxAdults >= LIMITS.adults.min && d.room.maxAdults <= LIMITS.adults.max,
    ],
    [
      "Number of units",
      (d) => d.room.units >= LIMITS.units.min && d.room.units <= LIMITS.units.max,
    ],
  ],
  photos: [
    [`At least ${LIMITS.minPhotos} photos`, (d) => d.photos.length >= LIMITS.minPhotos],
    ["Alt text on every photo", (d) => d.photos.every((p) => length(p.altText) > 0)],
  ],
  amenities: [["At least one amenity", (d) => d.room.amenityKeys.length > 0]],
  rates: [["At least one active rate", (d) => d.rates.some((r) => r.active)]],
};

export function sectionStatus(section: RoomSectionId, data: RoomEditorData): SectionStatus {
  const missing = RULES[section].filter(([, ok]) => !ok(data)).map(([label]) => label);
  return { complete: missing.length === 0, missing };
}

export function allSectionStatuses(data: RoomEditorData): Record<RoomSectionId, SectionStatus> {
  return Object.fromEntries(
    ROOM_SECTION_IDS.map((id) => [id, sectionStatus(id, data)]),
  ) as Record<RoomSectionId, SectionStatus>;
}

export function completedCount(data: RoomEditorData): number {
  return ROOM_SECTION_IDS.filter((id) => sectionStatus(id, data).complete).length;
}

/** A room goes on sale only when all five sections are done. */
export function canPublish(data: RoomEditorData): boolean {
  return completedCount(data) === ROOM_SECTION_IDS.length;
}
