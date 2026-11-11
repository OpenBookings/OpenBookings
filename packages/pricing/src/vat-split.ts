/**
 * The VAT inside each night of a booking, split into room and breakfast, for
 * the host's bookkeeping. Guests never see it.
 *
 * Prices are VAT-inclusive euros. When the rate includes breakfast, the
 * breakfast part of a night is the host's breakfast value per person times
 * the people staying, never more than the night itself; the rest is the room.
 * Every part is rounded to cents, and totals add up the rounded parts.
 */

import { vatRatesFor, type AccommodationType } from "./vat-rates";

export interface VatPart {
  /** VAT-inclusive euros. */
  gross: number;
  /** Percent. */
  rate: number;
  /** The VAT inside `gross`. */
  vat: number;
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
  /** One entry per night, with the room price for that night (incl. VAT). */
  nights: { date: string; price: number }[];
  includesBreakfast: boolean;
  /** Euros per person per night. Null = unknown. */
  breakfastValue: number | null;
  people: number;
}

/** Null when any night has no known rates (a country or date outside the table). */
export function splitVat(input: VatSplitInput): VatSplit | null {
  const breakfastValueMissing = input.includesBreakfast && input.breakfastValue === null;
  const breakfastPerNight =
    input.includesBreakfast && input.breakfastValue !== null ? input.breakfastValue * input.people : null;

  const nights: NightVat[] = [];
  for (const night of input.nights) {
    const rates = vatRatesFor(input.country, input.type, night.date);
    if (!rates) return null;

    const breakfastGross =
      breakfastPerNight === null ? null : round2(Math.max(0, Math.min(breakfastPerNight, night.price)));
    nights.push({
      date: night.date,
      room: part(round2(night.price - (breakfastGross ?? 0)), rates.accommodation),
      breakfast: breakfastGross === null ? null : part(breakfastGross, rates.breakfast),
    });
  }

  return { nights, totals: totals(nights), breakfastValueMissing };
}

function part(gross: number, rate: number): VatPart {
  return { gross, rate, vat: round2((gross * rate) / (100 + rate)) };
}

function totals(nights: NightVat[]): VatTotal[] {
  const byKey = new Map<string, VatTotal>();
  const add = (kind: VatTotal["part"], p: VatPart) => {
    const key = `${kind}|${p.rate}`;
    const total = byKey.get(key) ?? { part: kind, gross: 0, rate: p.rate, vat: 0 };
    total.gross += p.gross;
    total.vat += p.vat;
    byKey.set(key, total);
  };
  for (const night of nights) add("accommodation", night.room);
  for (const night of nights) if (night.breakfast) add("breakfast", night.breakfast);
  return [...byKey.values()].map((t) => ({ ...t, gross: round2(t.gross), vat: round2(t.vat) }));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
