/**
 * The checkout ledger: how the charged total is built, and what is paid at
 * the property instead.
 *
 * Pure and built from the intent's snapshot. The caller compares the pay-now
 * sum to Stripe's total and falls back to Stripe's own lines on any
 * difference, so a guest never sees a breakdown that disagrees with the charge.
 */

import type { ExtraGuestLine, PayAtPropertyLine, TouristTaxLine } from '@openbookings/pricing';

export type LedgerRoom = {
  roomName: string;
  rateNights: { date: string; price: number }[];
  extraGuests: ExtraGuestLine[];
  discount: { label: string; amount: number } | null;
  touristTaxLines: TouristTaxLine[];
  payAtPropertyLines: PayAtPropertyLine[];
};

export type LedgerRow = {
  label: string;
  detail?: string;
  /** Euros; negative for a discount. */
  amount: number;
  kind: 'stay' | 'extra' | 'discount' | 'tax';
};

export type Ledger = {
  rows: LedgerRow[];
  payNow: number;
  atProperty: { label: string; detail: string; amount: number } | null;
  totalForStay: number;
};

const toCents = (euros: number) => Math.round(euros * 100);
const fromCents = (cents: number) => cents / 100;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "€185.00"; a negative amount gets a real minus sign: "−€60.00". */
export function formatMoney(euros: number): string {
  const text = `€${Math.abs(euros).toFixed(2)}`;
  return euros < 0 ? `−${text}` : text;
}

/** A unit price inside a sentence: "€185", "€92.50". */
function unitMoney(euros: number): string {
  return Number.isInteger(euros) ? `€${euros}` : `€${euros.toFixed(2)}`;
}

/** The date string read as a calendar date, so no timezone can shift the weekday. */
function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}

function nightsDetail(rateNights: LedgerRoom['rateNights']): string {
  const first = rateNights[0]!.price;
  if (rateNights.every((night) => night.price === first)) {
    return `${unitMoney(first)} × ${rateNights.length} ${plural(rateNights.length, 'night', 'nights')}`;
  }
  return rateNights.map((night) => `${weekday(night.date)} ${unitMoney(night.price)}`).join(' · ');
}

function atPropertyText(line: PayAtPropertyLine): string {
  const cot = line.label === 'Cots';
  const noun = cot ? plural(line.count, 'cot', 'cots') : plural(line.count, 'extra bed', 'extra beds');
  if (line.fee_per_night <= 0) return `${noun} free`;
  const count = line.count > 1 ? `${line.count} ` : '';
  return `${count}${noun} ${unitMoney(line.fee_per_night)} × ${line.nights} ${plural(line.nights, 'night', 'nights')}`;
}

/** What the snapshot says is charged now, in cents. */
export function ledgerPayNowCents(rooms: LedgerRoom[]): number {
  return rooms.reduce(
    (sum, room) =>
      sum +
      room.rateNights.reduce((s, night) => s + toCents(night.price), 0) +
      room.extraGuests.reduce((s, guest) => s + toCents(guest.amount), 0) -
      (room.discount ? toCents(room.discount.amount) : 0) +
      room.touristTaxLines.reduce((s, tax) => s + toCents(tax.amount), 0),
    0,
  );
}

/** Null when the breakdown cannot be shown, or when it does not add up to what Stripe charges. */
export function buildLedger(rooms: LedgerRoom[], propertyName: string, stripeTotalCents: number): Ledger | null {
  void propertyName;
  if (rooms.some((room) => room.rateNights.length === 0)) return null;

  const rows: LedgerRow[] = [];
  const atPropertyLines: PayAtPropertyLine[] = [];

  for (const room of rooms) {
    const n = room.rateNights.length;
    const stayCents = room.rateNights.reduce((sum, night) => sum + toCents(night.price), 0);
    rows.push({
      label: `${room.roomName} · ${n} ${plural(n, 'night', 'nights')}`,
      detail: nightsDetail(room.rateNights),
      amount: fromCents(stayCents),
      kind: 'stay',
    });
    for (const guest of room.extraGuests) {
      rows.push({
        label: guest.kind === 'child' ? 'Extra child (2–12)' : 'Extra adult',
        detail: `${unitMoney(guest.per_night)} × ${guest.nights} ${plural(guest.nights, 'night', 'nights')}`,
        amount: guest.amount,
        kind: 'extra',
      });
    }
    if (room.discount) {
      rows.push({ label: room.discount.label, amount: -room.discount.amount, kind: 'discount' });
    }
    for (const tax of room.touristTaxLines) {
      rows.push({ label: 'Tourist tax', detail: tax.label, amount: tax.amount, kind: 'tax' });
    }
    atPropertyLines.push(...room.payAtPropertyLines);
  }

  const payNowCents = ledgerPayNowCents(rooms);
  if (payNowCents !== stripeTotalCents) return null;

  const atPropertyCents = atPropertyLines.reduce((sum, line) => sum + toCents(line.amount), 0);
  const text = atPropertyLines.map(atPropertyText).join(' · ');
  const atProperty =
    atPropertyLines.length > 0
      ? {
          label: 'At the property',
          detail: text.charAt(0).toUpperCase() + text.slice(1),
          amount: fromCents(atPropertyCents),
        }
      : null;

  return {
    rows,
    payNow: fromCents(payNowCents),
    atProperty,
    totalForStay: fromCents(payNowCents + atPropertyCents),
  };
}
