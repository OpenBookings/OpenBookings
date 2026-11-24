import type { AppBooking } from "@openbookings/apps-contract";

/** Seconds to wait before attempt 2, 3, 4 and 5 (index = failed attempts - 1). The 5th failure is final. */
export const RETRY_SECONDS = [5, 15, 30, 60];

export type OutboxRow = {
  acked: "none" | "committed" | "cancelled";
  ackedVersion: number | null;
  latest: AppBooking;
  latestVersion: number;
  status: "waiting" | "sending" | "retrying" | "delivered" | "needs_attention" | "not_sent";
  attempts: number;
};

export type NextMessage = { send: "Commit" | "Modify" | "Cancel"; booking: AppBooking } | { send: "none" } | { needsAttention: string };

type Sent = "Commit" | "Modify" | "Cancel";
type Result = { ok: true } | { ok: false; permanent: boolean; error: string };

const MAX_ATTEMPTS = RETRY_SECONDS.length + 1;

/** A booking is cancelled for the hotel when the whole booking is, or every one of its (at least one) rooms is. */
const isCancelled = (b: AppBooking) => b.cancelled || (b.rooms.length > 0 && b.rooms.every((r) => r.cancelled));

/**
 * What to send next for one booking, from the outbox row alone (SiteMinder: Commit -> Modify -> Cancel, nothing
 * after Cancel, every Modify/Cancel carries the full booking, a repeated Commit ID is ignored).
 *
 * Edge cases, each decided on purpose:
 * - `not_sent` (the channel is not meant to hear about this booking) -> none.
 * - Never acknowledged -> Commit, even when the latest version is cancelled: the hotel must see Commit and then
 *   Cancel. After the Commit is acked, the next call yields the Cancel (see below) although the version is equal.
 * - Every room cancelled but `cancelled` false -> treated as Cancel: SiteMinder has no "empty booking" and a
 *   Modify without rooms would be invalid.
 * - Committed, latest cancelled -> Cancel, never Modify. Committed, latest not cancelled and
 *   `latestVersion <= ackedVersion` -> none (nothing new). Committed with an unknown acked version -> Modify.
 * - Cancelled and latest still cancelled -> none (also for a newer cancelled version: Cancel is terminal).
 *   Cancelled and latest no longer cancelled (forced un-cancel) -> needs attention, never re-Commit.
 * - A `needs_attention` row still computes what would be sent. Whether to retry such a row is C4's call: the
 *   store only puts it back to `waiting` on a strictly newer version, so C4 should send needs_attention rows
 *   only after that, not on every tick.
 */
export function nextMessage(row: OutboxRow): NextMessage {
  if (row.status === "not_sent") return { send: "none" };
  const cancelled = isCancelled(row.latest);
  if (row.acked === "none") return { send: "Commit", booking: row.latest };
  if (row.acked === "cancelled") {
    return cancelled ? { send: "none" } : { needsAttention: "reopened after cancellation — tell the hotel" };
  }
  if (cancelled) return { send: "Cancel", booking: row.latest };
  if (row.ackedVersion !== null && row.latestVersion <= row.ackedVersion) return { send: "none" };
  return { send: "Modify", booking: row.latest };
}

/**
 * The row's new delivery state after one send. `row` is the FRESH row (re-read after the send), `sentVersion`
 * the version that message carried (defaults to `row.latestVersion`, i.e. nothing changed meanwhile).
 *
 * - Success: acked moves to committed (Commit/Modify) or cancelled (Cancel) at `sentVersion`; attempts reset to 0.
 *   `delivered` only when nothing else is pending: the sent version is still the latest and `nextMessage` of the
 *   new row has nothing to send. Otherwise `waiting`, so the next call sends it: a newer version arrived during
 *   the send, or a Commit of an already-cancelled booking still needs its Cancel. A reopen after Cancel also
 *   goes to `waiting`; the next `nextMessage` reports the needs-attention reason.
 * - Permanent failure: `needs_attention` at once, attempts counted, acked unchanged (a failed Commit stays 'none').
 * - Transient failure: attempts + 1; the 5th failure -> `needs_attention`, else `retrying` after
 *   `RETRY_SECONDS[attempts - 1]` (5, 15, 30, 60).
 */
export function afterResult(
  row: OutboxRow,
  sent: Sent,
  result: Result,
  sentVersion: number = row.latestVersion,
): Pick<OutboxRow, "acked" | "ackedVersion" | "status" | "attempts"> & { retryInSeconds: number | null } {
  if (!result.ok) {
    const attempts = row.attempts + 1;
    const final = result.permanent || attempts >= MAX_ATTEMPTS;
    return {
      acked: row.acked,
      ackedVersion: row.ackedVersion,
      attempts,
      status: final ? "needs_attention" : "retrying",
      retryInSeconds: final ? null : (RETRY_SECONDS[attempts - 1] ?? null),
    };
  }
  const acked = sent === "Cancel" ? "cancelled" : "committed";
  const next: OutboxRow = { ...row, acked, ackedVersion: sentVersion, attempts: 0 };
  const after = nextMessage(next);
  const pending = sentVersion < row.latestVersion || "needsAttention" in after || after.send !== "none";
  return { acked, ackedVersion: sentVersion, attempts: 0, status: pending ? "waiting" : "delivered", retryInSeconds: null };
}
