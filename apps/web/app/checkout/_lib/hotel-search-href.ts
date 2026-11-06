/**
 * The hotel page for the same stay: its dates, and the party added up across
 * the rooms. Where a guest whose payment did not go through starts again.
 */
export function hotelSearchHref(intent: {
  propertySlug: string;
  checkIn: string;
  checkOut: string;
  rooms: { adults: number; children: number }[];
}): string {
  const params = new URLSearchParams({
    checkin: intent.checkIn,
    checkout: intent.checkOut,
    adults: String(intent.rooms.reduce((sum, room) => sum + room.adults, 0)),
    children: String(intent.rooms.reduce((sum, room) => sum + room.children, 0)),
    rooms: String(intent.rooms.length),
  });
  return `/p/${encodeURIComponent(intent.propertySlug)}?${params}`;
}
