/**
 * How the tourist tax on a stay compares to its room price. Commission is
 * taken on the room price only, so a tax out of proportion moves booking
 * value out of the commission base. More than half is unusual and flagged for
 * staff; more than the room price itself is not a real tourist tax and the
 * stay is not priced.
 */
export function touristTaxShare(roomsTotal: number, touristTaxTotal: number): "ok" | "flag" | "refuse" {
  if (touristTaxTotal <= 0) return "ok";
  if (touristTaxTotal > roomsTotal) return "refuse";
  if (touristTaxTotal > roomsTotal / 2) return "flag";
  return "ok";
}
