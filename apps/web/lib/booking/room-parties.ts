/** Who sleeps in one room. Infants take no place but count for tourist tax. */
export type RoomParty = { adults: number; children: number; infants: number };

/**
 * The party in each of `rooms` rooms of one type, split the way the property
 * page splits it (splitParty): adults, then children, then infants dealt from
 * the first room, so the first rooms take any extra. The first room is the
 * largest share, the one perRoomParty describes.
 */
export function evenRoomParties(i: { adults: number; children: number; infants?: number; rooms: number }): RoomParty[] {
  const n = Math.max(1, Math.trunc(i.rooms));
  const share = (count: number, k: number) => Math.floor(count / n) + (k < count % n ? 1 : 0);
  return Array.from({ length: n }, (_, k) => ({
    adults: share(i.adults, k),
    children: share(i.children, k),
    infants: share(i.infants ?? 0, k),
  }));
}
