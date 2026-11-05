import { localTimeToUtc, type CancellationTier } from "@openbookings/pricing";
import type { HostReservationRow } from "./shape";

/**
 * The booking as the host reads it: one sentence for right now, then the
 * milestones in order with "Today" among them. Each milestone carries the
 * rule that starts there, so the policy reads top to bottom. Formatted on
 * the server, in the property's time zone.
 *
 * Ported from the guest's version (apps/web/app/bookings/[booking-ref]/
 * _lib/timeline.ts): the same milestones and rules, in words for staff.
 * A change to when a rule starts belongs in both.
 */

export type Tone = "free" | "fee" | "stay" | "done" | "cancelled" | "noshow";

export type TimelineStep = {
  key: string;
  label: string;
  date: string;
  time: string | null;
  /** A second line under the label, e.g. which rooms a deadline is for. */
  note?: string;
  /** What changes from this point on, in a sentence. */
  detail?: string;
  state: "past" | "today" | "future";
  /** Colours the dot when the step is an outcome (cancelled, no-show). */
  tone?: Tone;
};

export type HostTimeline = {
  headline: { tone: Tone; eyebrow: string; sentence: string };
  steps: TimelineStep[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const formats = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, timeZone: string, opts: Intl.DateTimeFormatOptions) {
  const id = `${key}|${timeZone}`;
  let f = formats.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, ...opts });
    formats.set(id, f);
  }
  return f;
}

const dayOf = (d: number, tz: string) =>
  fmt("day", tz, { weekday: "short", day: "numeric", month: "short" }).format(new Date(d)).replace(",", "");
const timeOf = (d: number, tz: string) =>
  fmt("time", tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
const when = (d: number, tz: string) => `${dayOf(d, tz)}, ${timeOf(d, tz)}`;
const euros = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });

/** "12 days", "5 hours", "under an hour". */
export function timeLeft(ms: number): string {
  if (ms >= 2 * DAY) return `${Math.floor(ms / DAY)} days`;
  if (ms >= 2 * HOUR) return `${Math.floor(ms / HOUR)} hours`;
  if (ms >= HOUR) return "1 hour";
  return "under an hour";
}

type Point = { key: string; at: number; label: string; showTime: boolean; note?: string; detail?: string; tone?: Tone };

export function buildHostTimeline(row: HostReservationRow, now: Date): HostTimeline {
  const tz = row.timezone;
  const t = now.getTime();
  const snapshotCheckIn = row.rooms.find((r) => r.check_in_at)?.check_in_at;
  const checkIn = snapshotCheckIn
    ? Date.parse(snapshotCheckIn)
    : localTimeToUtc(row.check_in_date, row.check_in_time ?? "15:00", tz).getTime();
  const checkOut = localTimeToUtc(row.check_out_date, row.check_out_time ?? "11:00", tz).getTime();
  const booked = Math.min(row.confirmed_at ? Date.parse(row.confirmed_at) : checkIn, checkIn);

  const nights = Math.round(
    (Date.parse(`${row.check_out_date}T00:00:00Z`) - Date.parse(`${row.check_in_date}T00:00:00Z`)) / DAY,
  );
  const active = row.rooms.filter((r) => !r.cancelled_at);
  const cancelled = row.status === "cancelled" || (row.rooms.length > 0 && active.length === 0);
  const noShow = row.status === "no_show";
  const over = row.status === "completed" || t >= checkOut;

  // Rooms that share a policy share a deadline.
  const groups = new Map<string, { tier: CancellationTier; deadline: number | null; rooms: string[] }>();
  for (const r of active) {
    const tier = r.cancellation_tier ?? "standard";
    const raw = tier === "non_refundable" || !r.full_refund_until ? null : Date.parse(r.full_refund_until);
    // A deadline already gone at booking never gave the guest a free window.
    const deadline = raw !== null && raw > booked && raw < checkIn ? raw : null;
    const key = `${tier}|${deadline}`;
    const g = groups.get(key) ?? { tier, deadline, rooms: [] };
    g.rooms.push(r.room_name);
    groups.set(key, g);
  }
  const several = groups.size > 1;
  const roomsOf = (g: { rooms: string[] }) => (several ? g.rooms.join(", ") : undefined);

  // ── Steps, each with the rule that starts there ──
  const live = !cancelled && !noShow && !over;
  const points: Point[] = [{ key: "booked", at: booked, label: "Booked", showTime: false }];
  if (cancelled) {
    const stamps = row.rooms.map((r) => (r.cancelled_at ? Date.parse(r.cancelled_at) : NaN)).filter(Number.isFinite);
    const at = Math.max(stamps.length ? Math.max(...stamps) : booked, booked);
    points.push({ key: "cancelled", at, label: "Cancelled", showTime: false, tone: "cancelled" });
  } else {
    for (const g of groups.values()) {
      if (g.deadline !== null) {
        points.push({
          key: `deadline-${points.length}`,
          at: g.deadline,
          label: "Free cancellation ends",
          note: roomsOf(g),
          showTime: true,
        });
      }
    }
    points.push(
      noShow
        ? { key: "check-in", at: checkIn, label: "No-show", showTime: false, tone: "noshow" }
        : { key: "check-in", at: checkIn, label: "Check-in", showTime: true },
      row.departed_early_on
        ? {
            key: "check-out",
            // The morning after the last night stayed.
            at: localTimeToUtc(row.departed_early_on, row.check_out_time ?? "11:00", tz).getTime() + DAY,
            label: "Left early",
            showTime: false,
            tone: "done",
          }
        : {
            key: "check-out",
            at: checkOut,
            label: "Check-out",
            showTime: true,
            // Early departure keeps the next 7 nights; a stay that short loses them all.
            detail:
              nights > 7
                ? "If the guest leaves early, the next 7 nights are still charged."
                : "If the guest leaves early, the remaining nights are still charged.",
          },
    );
  }
  points.sort((a, b) => a.at - b.at);

  const steps: TimelineStep[] = points.map((p) => {
    const state = p.at <= t ? "past" : "future";
    return {
      key: p.key,
      label: p.label,
      date: dayOf(p.at, tz),
      time: p.showTime ? timeOf(p.at, tz) : null,
      ...(p.note ? { note: p.note } : {}),
      // A rule only matters while it is still ahead.
      ...(p.detail && live && state === "future" ? { detail: p.detail } : {}),
      ...(p.tone ? { tone: p.tone } : {}),
      state,
    };
  });
  // "Today" sits among the steps while anything is still ahead.
  const ahead = steps.findIndex((s) => s.state === "future");
  if (ahead > 0) {
    steps.splice(ahead, 0, { key: "today", label: "Today", date: dayOf(t, tz), time: null, state: "today" });
  }

  return { headline: headline(), steps };

  function headline(): HostTimeline["headline"] {
    if (cancelled) {
      const refunded = Number(row.refunded);
      return {
        tone: "cancelled",
        eyebrow: "Cancelled",
        sentence: refunded > 0 ? `${euros.format(refunded)} was refunded to the guest.` : "Nothing was refunded.",
      };
    }
    if (noShow) {
      return { tone: "noshow", eyebrow: "No-show", sentence: "The guest didn't arrive. The stay wasn't refunded." };
    }
    if (over) {
      return { tone: "done", eyebrow: "Stay completed", sentence: `The guest checked out on ${dayOf(checkOut, tz)}.` };
    }
    if (t >= checkIn) {
      return row.status === "checked_in"
        ? { tone: "stay", eyebrow: "Checked in", sentence: `Check-out is on ${dayOf(checkOut, tz)}.` }
        : { tone: "stay", eyebrow: "Check-in is open", sentence: "The guest hasn't been checked in yet." };
    }
    // Before check-in: the earliest free window still open decides.
    const open = [...groups.values()]
      .map((g) => g.deadline)
      .filter((d): d is number => d !== null && d > t)
      .sort((a, b) => a - b);
    if (open.length) {
      const some = open.length < groups.size ? " for some rooms" : "";
      return {
        tone: "free",
        eyebrow: `Free cancellation${some}`,
        sentence: `The guest can cancel for a full refund until ${when(open[0], tz)}.`,
      };
    }
    return {
      tone: "fee",
      eyebrow: `Check-in in ${timeLeft(checkIn - t)}`,
      sentence: `Check-in from ${when(checkIn, tz)}. If the guest cancels now, the room price isn't refunded.`,
    };
  }
}
