import { addDays, enumerateDates, type DateRange } from "./period";
import type { BookingFact, InventoryFact, IsoDate, SoldNight } from "./types";

/** Raw, DB-shaped input rows. The SQL that produces them lives in the facts loader. */
export interface ReservationRow {
  reservationId: string;
  bookingId: string;
  sortIndex: number;
  bookingStatus: "pending" | "confirmed" | "cancelled" | "completed" | "no_show" | "checked_in";
  /** ISO instant in Amsterdam time with offset: coalesce(confirmed_at, created_at). Its first 10 characters are the Amsterdam date. */
  bookedAt: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  totalNights: number;
  departedEarlyOn: IsoDate | null;
  reservationCancelledAt: string | null;
  bookingCancelledAt: string | null;
  roomId: string;
  ratePlanId: string;
  /** Major units, the fallback when nightsJson is empty. */
  pricePerNight: number;
  /** Major units, VAT included. */
  nightsJson: { date: IsoDate; price: number }[];
  vatSplit: {
    nights: { date: IsoDate; room: { vat: number }; breakfast: { vat: number } | null }[];
  } | null;
  /** Major units, VAT included. */
  discountAmount: number | null;
  /** This reservation's share basis: the sum of its night prices in cents. */
  roomsTotalCents: number;
}

export interface BookingMoneyRow {
  bookingId: string;
  commissionCents: number;
  commissionRefundedCents: number;
  /** Succeeded refunds only. */
  accommodationRefunds: { reservationId: string | null; cents: number }[];
}

export interface CapacityRow {
  roomId: string;
  totalUnits: number;
  createdOn: IsoDate;
  archivedOn: IsoDate | null;
}

export interface InventoryOverrideRow {
  roomId: string;
  date: IsoDate;
  totalRooms: number | null;
  availableOverride: number | null;
  blockedRooms: number;
}

const toCents = (major: number) => Math.round(major * 100);

/**
 * Split `total` over `weights` pro rata, whole cents only. Remainder cents go to
 * the first entry (callers pass them sorted by sortIndex). Zero weights: all to the first.
 */
function splitPro(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  shares[0] += total - shares.reduce((a, b) => a + b, 0);
  return shares;
}

interface Built {
  row: ReservationRow;
  dates: IsoDate[];
  netNights: number[];
  grossTotal: number;
}

function buildNights(row: ReservationRow): Built {
  const priced =
    row.nightsJson.length > 0
      ? row.nightsJson
      : Array.from({ length: row.totalNights }, (_, i) => ({
          date: addDays(row.checkIn, i),
          price: row.pricePerNight,
        }));
  const vatByDate = new Map<IsoDate, number>();
  for (const n of row.vatSplit?.nights ?? []) {
    vatByDate.set(n.date, toCents(n.room.vat) + toCents(n.breakfast?.vat ?? 0));
  }
  const netNights = priced.map((n) => toCents(n.price) - (vatByDate.get(n.date) ?? 0));
  const grossTotal = priced.reduce((a, n) => a + toCents(n.price), 0);
  return { row, dates: priced.map((n) => n.date), netNights, grossTotal };
}

export function mapBookings(
  rows: ReservationRow[],
  money: BookingMoneyRow[],
): { bookings: BookingFact[]; nights: SoldNight[] } {
  const moneyById = new Map(money.map((m) => [m.bookingId, m]));
  const live = rows.filter((r) => r.bookingStatus !== "pending");

  const byBooking = new Map<string, ReservationRow[]>();
  for (const r of live) {
    const list = byBooking.get(r.bookingId) ?? [];
    list.push(r);
    byBooking.set(r.bookingId, list);
  }

  const grossRefund = new Map<string, number>();
  const commission = new Map<string, number>();
  for (const [bookingId, group] of byBooking) {
    const sorted = [...group].sort((a, b) => a.sortIndex - b.sortIndex);
    const m = moneyById.get(bookingId);
    const weights = sorted.map((r) => r.roomsTotalCents);
    let bookingLevel = 0;
    for (const refund of m?.accommodationRefunds ?? []) {
      if (refund.reservationId === null) bookingLevel += refund.cents;
      else if (sorted.some((r) => r.reservationId === refund.reservationId)) {
        grossRefund.set(refund.reservationId, (grossRefund.get(refund.reservationId) ?? 0) + refund.cents);
      }
    }
    splitPro(bookingLevel, weights).forEach((cents, i) => {
      const id = sorted[i].reservationId;
      grossRefund.set(id, (grossRefund.get(id) ?? 0) + cents);
    });
    const net = (m?.commissionCents ?? 0) - (m?.commissionRefundedCents ?? 0);
    splitPro(net, weights).forEach((cents, i) => commission.set(sorted[i].reservationId, cents));
  }

  const bookings: BookingFact[] = [];
  const nights: SoldNight[] = [];

  for (const row of live) {
    const built = buildNights(row);
    const netTotal = built.netNights.reduce((a, b) => a + b, 0);
    const ratio = built.grossTotal > 0 ? netTotal / built.grossTotal : 1;

    const refundNet = Math.min(
      Math.max(Math.round((grossRefund.get(row.reservationId) ?? 0) * ratio), 0),
      Math.max(netTotal, 0),
    );
    const spread = splitSpread(refundNet, built.netNights);
    const nightlyNetCents = built.netNights.map((n, i) => n - spread[i]);
    const netRevenueCents = netTotal - refundNet;

    const cancelled = row.reservationCancelledAt !== null || row.bookingStatus === "cancelled";
    const status: BookingFact["status"] = cancelled
      ? "cancelled"
      : row.bookingStatus === "checked_in"
        ? "confirmed"
        : (row.bookingStatus as BookingFact["status"]);
    const discountCents = Math.round(toCents(row.discountAmount ?? 0) * ratio);

    bookings.push({
      id: row.reservationId,
      createdAt: row.bookedAt,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      nights: row.totalNights,
      status,
      cancelledAt: row.reservationCancelledAt ?? row.bookingCancelledAt,
      adults: 0,
      children: 0,
      guestKey: "",
      guestCountry: "",
      hasGuestDetails: false,
      roomId: row.roomId,
      ratePlanId: row.ratePlanId,
      nightlyNetCents,
      netRevenueCents,
      basePriceCents: netRevenueCents + discountCents,
      discountCents,
      cancellationFeeCents: cancelled ? netRevenueCents : 0,
      commissionCents: commission.get(row.reservationId) ?? 0,
    });

    if (cancelled || status === "no_show") continue;
    built.dates.forEach((date, i) => {
      if (row.departedEarlyOn !== null && date > row.departedEarlyOn) return;
      nights.push({
        date,
        roomId: row.roomId,
        ratePlanId: row.ratePlanId,
        bookingId: row.reservationId,
        revenueCents: nightlyNetCents[i],
      });
    });
  }

  return { bookings, nights };
}

/** Pro rata to each night's net, remainder cents on the last night. */
function splitSpread(total: number, netNights: number[]): number[] {
  const sum = netNights.reduce((a, b) => a + b, 0);
  if (netNights.length === 0) return [];
  const shares = netNights.map((n) => (sum > 0 ? Math.floor((total * n) / sum) : 0));
  shares[shares.length - 1] += total - shares.reduce((a, b) => a + b, 0);
  return shares;
}

export function mapInventory(
  range: DateRange,
  rooms: CapacityRow[],
  overrides: InventoryOverrideRow[],
): InventoryFact[] {
  const byKey = new Map(overrides.map((o) => [`${o.roomId}|${o.date}`, o]));
  const out: InventoryFact[] = [];
  for (const room of rooms) {
    const from = room.createdOn > range.from ? room.createdOn : range.from;
    const lastDay = room.archivedOn === null ? null : addDays(room.archivedOn, -1);
    const to = lastDay !== null && lastDay < range.to ? lastDay : range.to;
    for (const date of enumerateDates(from, to)) {
      const o = byKey.get(`${room.roomId}|${date}`);
      out.push({
        date,
        roomId: room.roomId,
        unitsTotal: o?.availableOverride ?? o?.totalRooms ?? room.totalUnits,
        unitsOutOfOrder: o?.blockedRooms ?? 0,
      });
    }
  }
  return out;
}
