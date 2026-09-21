/**
 * `properties.location` is NOT NULL, so onboarding promotion stores POINT(0 0)
 * for a host whose onboarding captured no coordinates (promotion.ts). The exact
 * origin is therefore the "no pin yet" sentinel, and every reader — the
 * completion checklist, the save schema, and the editor's map — has to agree on
 * it. They did not, which is why the editor opened at street zoom over the
 * Gulf of Guinea and then refused to save what it was showing.
 *
 * Only the exact origin counts: the equator and the Greenwich meridian are real
 * places, and a property on either keeps its pin.
 */
export function hasPin(lat: number | null, lon: number | null): boolean {
  return lat !== null && lon !== null && !(lat === 0 && lon === 0);
}
