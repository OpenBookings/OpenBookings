import type { RoomEditorData } from "../../_lib/types";

/** Every room section receives exactly this, like the Property editor's sections. */
export interface RoomSectionProps {
  data: RoomEditorData;
  onDirtyChange: (dirty: boolean) => void;
}
