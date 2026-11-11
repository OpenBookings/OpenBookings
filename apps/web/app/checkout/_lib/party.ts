/** "2 adults", "1 child, 2–12", "1 infant, under 2": who is coming, zero counts left out. */
export function partyFacts(r: { adults: number; children: number; infants: number }): string[] {
  const facts: string[] = [];
  if (r.adults > 0) facts.push(`${r.adults} ${r.adults === 1 ? 'adult' : 'adults'}`);
  if (r.children > 0) facts.push(`${r.children} ${r.children === 1 ? 'child' : 'children'}, 2–12`);
  if (r.infants > 0) facts.push(`${r.infants} ${r.infants === 1 ? 'infant' : 'infants'}, under 2`);
  return facts;
}

/**
 * The line under the schedule about cots and extra beds, which are paid at the
 * property and so never cost anything to cancel. Null when nothing is paid there.
 */
export function payAtPropertyNote(rooms: { payAtProperty: number; cots: number; extraBeds: number }[]): string | null {
  const paying = rooms.filter((r) => r.payAtProperty > 0);
  if (paying.length === 0) return null;
  const cots = paying.reduce((n, r) => n + r.cots, 0);
  const beds = paying.reduce((n, r) => n + r.extraBeds, 0);
  const noun = cots > 0 && beds > 0 ? 'cot and extra bed' : cots > 0 ? 'cot' : 'extra bed';
  const plural = cots + beds > 1;
  const nounText = cots > 0 && beds > 0 ? 'cot and extra bed' : noun + (plural ? 's' : '');
  return `The ${nounText} ${plural ? 'are' : 'is'} paid at the property, so cancelling never costs you for ${plural ? 'them' : 'it'}.`;
}
