/**
 * The age bands, the same at every hotel: adults 13 or over, children 2–12,
 * infants under 2. Infants don't take a place in the room.
 */

/** The youngest age that counts as an adult. */
export const ADULT_MIN_AGE = 13;
/** The youngest age that counts as a child; anyone younger is an infant. */
export const CHILD_MIN_AGE = 2;

/** Each band as a label, e.g. under a guest counter. */
export const AGE_BANDS = {
  adults: `Ages ${ADULT_MIN_AGE} or above`,
  children: `Ages ${CHILD_MIN_AGE}–${ADULT_MIN_AGE - 1}`,
  infants: `Under ${CHILD_MIN_AGE}`,
} as const;

/** Each band as it reads mid-sentence: "children 2–12, infants under 2". */
export const AGE_RANGES = {
  adults: `${ADULT_MIN_AGE} or over`,
  children: `${CHILD_MIN_AGE}–${ADULT_MIN_AGE - 1}`,
  infants: `under ${CHILD_MIN_AGE}`,
} as const;
