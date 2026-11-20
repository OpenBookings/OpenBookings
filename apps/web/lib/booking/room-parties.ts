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

/** "adults/children/infants": how a priced party is looked up. */
export function partyKey(p: { adults: number; children: number; infants?: number }): string {
  return `${p.adults}/${p.children}/${p.infants ?? 0}`;
}

/**
 * Every party one room could be given when `party` is split over any number
 * of rooms that sleep at most `maxAdults` adults and `maxChildren` children
 * (and `maxInfants` infants): at least one adult, never more of anyone than
 * the party has. The stay quote prices each, so the page can add up the
 * split it actually books.
 */
export function possibleRoomParties(
  party: { adults: number; children: number; infants?: number },
  room: { maxAdults: number; maxChildren: number; maxInfants: number },
): RoomParty[] {
  const parties: RoomParty[] = [];
  const maxA = Math.min(party.adults, room.maxAdults);
  const maxC = Math.min(party.children, room.maxChildren);
  const maxI = Math.min(party.infants ?? 0, room.maxInfants);
  for (let adults = 1; adults <= maxA; adults++) {
    for (let children = 0; children <= maxC; children++) {
      for (let infants = 0; infants <= maxI; infants++) parties.push({ adults, children, infants });
    }
  }
  return parties;
}
