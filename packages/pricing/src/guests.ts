/**
 * The age bands, the same at every hotel: adults 13 or over, children 2–12,
 * infants under 2. Infants don't take a place in the room.
 */

/** Each band as a label, e.g. under a guest counter. */
export const AGE_BANDS = {
  adults: "Ages 13 or above",
  children: "Ages 2–12",
  infants: "Under 2",
} as const;

/** Each band as it reads mid-sentence: "children 2–12, infants under 2". */
export const AGE_RANGES = {
  adults: "13 or over",
  children: "2–12",
  infants: "under 2",
} as const;
