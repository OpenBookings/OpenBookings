/**
 * The checkout ledger: how the charged total is built, and what is paid at
 * the property instead.
 *
 * Pure and built from the intent's snapshot, in integer cents. The caller
 * compares the pay-now sum to Stripe's total and falls back to Stripe's own
 * lines on any difference, so a guest never sees a breakdown that disagrees
 * with the charge. Shown with `formatCents(…, { whole: 'always-decimals' })`.
 */

import {
  AGE_RANGES,
  type ExtraGuestLine,
  type NightPrice,
  type PayAtPropertyLine,
  type TouristTaxLine,
} from '@openbookings/pricing';
import { formatCents } from '@openbookings/pricing/money';

export type LedgerRoom = {
  roomName: string;
  rateNights: NightPrice[];
  extraGuests: ExtraGuestLine[];
  discount: { label: string; amountCents: number } | null;
  touristTaxLines: TouristTaxLine[];
  payAtPropertyLines: PayAtPropertyLine[];
};

export type LedgerRow = {
  label: string;
  detail?: string;
  /** Negative for a discount. */
  amountCents: number;
  kind: 'stay' | 'extra' | 'discount' | 'tax';
};

export type Ledger = {
  rows: LedgerRow[];
  payNowCents: number;
  atProperty: { label: string; detail: string; amountCents: number } | null;
  totalForStayCents: number;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** A unit price inside a sentence: "€185", "€92.50". */
const unitMoney = (cents: number) => formatCents(cents);

/** The date string read as a calendar date, so no timezone can shift the weekday. */
function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}

function nightsDetail(rateNights: LedgerRoom['rateNights']): string {
  const first = rateNights[0]!.priceCents;
  if (rateNights.every((night) => night.priceCents === first)) {
    return `${unitMoney(first)} × ${rateNights.length} ${plural(rateNights.length, 'night', 'nights')}`;
  }
  return rateNights.map((night) => `${weekday(night.date)} ${unitMoney(night.priceCents)}`).join(' · ');
}

function atPropertyText(line: PayAtPropertyLine): string {
  const cot = line.label === 'Cots';
  const noun = cot ? plural(line.count, 'cot', 'cots') : plural(line.count, 'extra bed', 'extra beds');
  if (line.feePerNightCents <= 0) return `${noun} free`;
  const count = line.count > 1 ? `${line.count} ` : '';
  return `${count}${noun} ${unitMoney(line.feePerNightCents)} × ${line.nights} ${plural(line.nights, 'night', 'nights')}`;
}

/** What the snapshot says is charged now, in cents. */
export function ledgerPayNowCents(rooms: LedgerRoom[]): number {
  return rooms.reduce(
    (sum, room) =>
      sum +
      room.rateNights.reduce((s, night) => s + night.priceCents, 0) +
      room.extraGuests.reduce((s, guest) => s + guest.amountCents, 0) -
      (room.discount ? room.discount.amountCents : 0) +
      room.touristTaxLines.reduce((s, tax) => s + tax.amountCents, 0),
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
    const stayCents = room.rateNights.reduce((sum, night) => sum + night.priceCents, 0);
    rows.push({
      label: `${room.roomName} · ${n} ${plural(n, 'night', 'nights')}`,
      detail: nightsDetail(room.rateNights),
      amountCents: stayCents,
      kind: 'stay',
    });
    for (const guest of room.extraGuests) {
      rows.push({
        label: guest.kind === 'child' ? `Extra child (${AGE_RANGES.children})` : 'Extra adult',
        detail: `${unitMoney(guest.perNightCents)} × ${guest.nights} ${plural(guest.nights, 'night', 'nights')}`,
        amountCents: guest.amountCents,
        kind: 'extra',
      });
    }
    if (room.discount) {
      rows.push({ label: room.discount.label, amountCents: -room.discount.amountCents, kind: 'discount' });
    }
    for (const tax of room.touristTaxLines) {
      rows.push({ label: 'Tourist tax', detail: tax.label, amountCents: tax.amountCents, kind: 'tax' });
    }
    atPropertyLines.push(...room.payAtPropertyLines);
  }

  const payNowCents = ledgerPayNowCents(rooms);
  if (payNowCents !== stripeTotalCents) return null;

  const atPropertyCents = atPropertyLines.reduce((sum, line) => sum + line.amountCents, 0);
  const text = atPropertyLines.map(atPropertyText).join(' · ');
  const atProperty =
    atPropertyLines.length > 0
      ? {
          label: 'At the property',
          detail: text.charAt(0).toUpperCase() + text.slice(1),
          amountCents: atPropertyCents,
        }
      : null;

  return {
    rows,
    payNowCents,
    atProperty,
    totalForStayCents: payNowCents + atPropertyCents,
  };
}
