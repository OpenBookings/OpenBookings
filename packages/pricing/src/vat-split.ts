/**
 * The VAT inside each night of a booking, split into room and breakfast, for
 * the host's bookkeeping. Guests never see it.
 *
 * Prices are VAT-inclusive integer cents. When the rate includes breakfast,
 * the breakfast part of a night is the host's breakfast value per person times
 * the people staying, never more than the night itself; the rest is the room,
 * so the parts of a night always add back up to its price. The VAT in each
 * part is rounded half up to a whole cent, and totals add up those parts.
 */

import { roundHalfUp } from "./money";
import { vatRatesFor, type AccommodationType } from "./vat-rates";

export interface VatPart {
  /** VAT-inclusive cents. */
  grossCents: number;
  /** Percent. */
  rate: number;
  /** The VAT inside `grossCents`, in cents. */
  vatCents: number;
}

/** One line per part and rate, e.g. "Accommodation 21%". */
export interface VatTotal extends VatPart {
  part: "accommodation" | "breakfast";
}

export interface NightVat {
  date: string;
  room: VatPart;
  /** Null when the rate has no breakfast, or its value is unknown. */
  breakfast: VatPart | null;
}

export interface VatSplit {
  nights: NightVat[];
  /** Accommodation rates first, then breakfast, each in stay order. */
  totals: VatTotal[];
  /** The rate includes breakfast but the host gave no value, so it sits in the room part. */
  breakfastValueMissing: boolean;
}

export interface VatSplitInput {
  country: string;
  type: AccommodationType;
  /** One entry per night, with the room price for that night in cents (incl. VAT). */
  nights: { date: string; priceCents: number }[];
  includesBreakfast: boolean;
  /** Cents per person per night. Null = unknown. */
  breakfastValueCents: number | null;
  people: number;
}

/** Null when any night has no known rates (a country or date outside the table). */
export function splitVat(input: VatSplitInput): VatSplit | null {
  const breakfastValueMissing = input.includesBreakfast && input.breakfastValueCents === null;
  const breakfastPerNight =
    input.includesBreakfast && input.breakfastValueCents !== null ? input.breakfastValueCents * input.people : null;

  const nights: NightVat[] = [];
  for (const night of input.nights) {
    const rates = vatRatesFor(input.country, input.type, night.date);
    if (!rates) return null;

    const breakfastGross =
      breakfastPerNight === null ? null : Math.max(0, Math.min(breakfastPerNight, night.priceCents));
    nights.push({
      date: night.date,
      room: part(night.priceCents - (breakfastGross ?? 0), rates.accommodation),
      breakfast: breakfastGross === null ? null : part(breakfastGross, rates.breakfast),
    });
  }

  return { nights, totals: totals(nights), breakfastValueMissing };
}

function part(grossCents: number, rate: number): VatPart {
  return { grossCents, rate, vatCents: roundHalfUp((grossCents * rate) / (100 + rate)) };
}

function totals(nights: NightVat[]): VatTotal[] {
  const byKey = new Map<string, VatTotal>();
  const add = (kind: VatTotal["part"], p: VatPart) => {
    const key = `${kind}|${p.rate}`;
    const total = byKey.get(key) ?? { part: kind, grossCents: 0, rate: p.rate, vatCents: 0 };
    total.grossCents += p.grossCents;
    total.vatCents += p.vatCents;
    byKey.set(key, total);
  };
  for (const night of nights) add("accommodation", night.room);
  for (const night of nights) if (night.breakfast) add("breakfast", night.breakfast);
  return [...byKey.values()];
}
