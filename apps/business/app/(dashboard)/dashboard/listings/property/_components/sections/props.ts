import type { PropertyEditorData } from "../../_lib/types";

/** Every section receives exactly this. Overview additionally takes `amenities`. */
export interface SectionProps {
  data: PropertyEditorData;
  onDirtyChange: (dirty: boolean) => void;
}
