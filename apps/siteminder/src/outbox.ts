import type { AppBooking } from "@openbookings/apps-contract";
import { retryDelaySeconds } from "./retry";

/**
 * Transient failures are retried on the shared schedule (retry.ts) until RETRY_WINDOW_SECONDS have passed since the
 * first failure of the current message (guides_error-handling.md:248: back off, "then every 1 minute until a
 * minimum timeout of 30 minutes is reached").
 */
export const RETRY_WINDOW_SECONDS = 30 * 60;

export type OutboxRow = {
  acked: "none" | "committed" | "cancelled";
  ackedVersion: number | null;
  latest: AppBooking;
  latestVersion: number;
  status: "waiting" | "sending" | "retrying" | "delivered" | "needs_attention" | "not_sent";
  attempts: number;
  /**
   * The version of the first Commit sent while nothing is acked yet (recorded before the send, since a timeout,
   * a network error or a 5xx leaves unknown whether SiteMinder took it). Null once a Commit is acked.
   */
  commitAttemptVersion: number | null;
};

export type NextMessage = { send: "Commit" | "Modify" | "Cancel"; booking: AppBooking } | { send: "none" } | { needsAttention: string };

export type Sent = "Commit" | "Modify" | "Cancel";
/** How one send went: SiteMinder's Success, or a failure that is permanent (fix first) or transient (retry). */
export type Result = { ok: true } | { ok: false; permanent: boolean; error: string };

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
 * the version that message carried. It is required: a newer version may have arrived during the send, and
 * defaulting to `row.latestVersion` would ack a version SiteMinder never saw.
 *
 * - Success: acked moves to committed (Commit/Modify) or cancelled (Cancel) at `sentVersion`; attempts reset to 0.
 *   A Commit is acked at the LOWER of `sentVersion` and `commitAttemptVersion`: SiteMinder ignores a repeated
 *   Commit ID, so if an earlier Commit (v1) whose outcome was unknown did arrive, the hotel holds v1 and a Modify
 *   with the latest data must follow (a Modify of identical data is harmless). `commitAttemptVersion` is cleared.
 *   `delivered` only when nothing else is pending: the sent version is still the latest and `nextMessage` of the
 *   new row has nothing to send. Otherwise `waiting`, so the next call sends it: a newer version arrived during
 *   the send, or a Commit of an already-cancelled booking still needs its Cancel. A reopen after Cancel also
 *   goes to `waiting`; the next `nextMessage` reports the needs-attention reason.
 * - Failure while a newer version arrived (`sentVersion < row.latestVersion`): the newer version is a new
 *   message, as if it had come in after the failure (C1's reset): `waiting`, attempts 0, no retry wait, acked
 *   unchanged — also for a permanent refusal, which concerned the old version.
 * - Permanent failure: `needs_attention` at once, attempts counted, acked unchanged (a failed Commit stays 'none').
 * - Transient failure: attempts + 1; `retrying` after `RETRY_SECONDS[attempts - 1]` (5, 15, 30, 60, then 60
 *   each time), until the failure comes `RETRY_WINDOW_SECONDS` or more after the first failure of this message
 *   (`failingForSeconds`, 0 for the first failure): then `needs_attention`. Ignored on success.
 */
export function afterResult(
  row: OutboxRow,
  sent: Sent,
  result: Result,
  sentVersion: number,
  failingForSeconds: number,
): Pick<OutboxRow, "acked" | "ackedVersion" | "status" | "attempts" | "commitAttemptVersion"> & { retryInSeconds: number | null } {
  const { commitAttemptVersion } = row;
  if (!result.ok) {
    const unchanged = { acked: row.acked, ackedVersion: row.ackedVersion, commitAttemptVersion };
    if (sentVersion < row.latestVersion) return { ...unchanged, attempts: 0, status: "waiting", retryInSeconds: null };
    const attempts = row.attempts + 1;
    const final = result.permanent || failingForSeconds >= RETRY_WINDOW_SECONDS;
    return {
      ...unchanged,
      attempts,
      status: final ? "needs_attention" : "retrying",
      retryInSeconds: final ? null : retryDelaySeconds(attempts),
    };
  }
  const acked = sent === "Cancel" ? "cancelled" : "committed";
  const ackedVersion = sent === "Commit" && commitAttemptVersion !== null ? Math.min(sentVersion, commitAttemptVersion) : sentVersion;
  const next: OutboxRow = { ...row, acked, ackedVersion, attempts: 0, commitAttemptVersion: null };
  const after = nextMessage(next);
  const pending = ackedVersion < row.latestVersion || "needsAttention" in after || after.send !== "none";
  return { acked, ackedVersion, attempts: 0, status: pending ? "waiting" : "delivered", retryInSeconds: null, commitAttemptVersion: null };
}
