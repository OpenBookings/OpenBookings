import { randomUUID } from "node:crypto";
import type { AppBooking, DeliveryReport } from "@openbookings/apps-contract";
import { XMLValidator } from "fast-xml-parser";
import { alert } from "./alert";
import { CoreApiError, type CoreClient, UnknownBookingError } from "./core-client";
import type { Queryable } from "./db/migrate";
import { env } from "./env";
import { type AppInstallation, activeInstallations } from "./installations";
import { type OutboxRow, type Result, type Sent, afterResult, nextMessage } from "./outbox";
import { buildResNotif } from "./ota/res-notif";
import type { Credentials } from "./soap/envelope";
import { xmlParser } from "./soap/xml";
import type { TickDeps } from "./tick";

/**
 * How long to wait for SiteMinder's answer to a reservation (guides_error-handling.md:155: "between 60 and 120
 * seconds"). The 20 s in the integration requirements is SiteMinder's limit for OUR replies, not this.
 */
export const SITEMINDER_TIMEOUT_MS = 60_000;
/** A send holds its row ('sending') for its timeout plus this; after that another tick may take it over (a tick that died). */
const CLAIM_MARGIN_MS = 60_000;
const REPORTS_PER_ROUND = 100;
/** Our own alert (not the hotel's) after this many failures in a row of one booking: SiteMinder is likely down. */
export const ALERT_AFTER_FAILURES = 5;

/**
 * One POST of a reservation message to SiteMinder: throws on a network error or timeout, else the HTTP answer.
 * `timeoutMs` is how long it may take at most: a send only starts while the budget can hold all of it.
 */
export type Post = { (xml: string): Promise<{ status: number; body: string }>; readonly timeoutMs: number };
/** What we present to SiteMinder: our channel's RequestorID and the reservation endpoint's credentials. */
export type ReservationConfig = { requestorId: string; credentials: Credentials };
export type DeliveryCounts = { delivered: number; retrying: number; needsAttention: number };

/** `fetch` to SiteMinder's reservation endpoint, SOAP 1.1 as the docs require, giving up after `timeoutMs`. */
export function reservationPoster(url: () => string, timeoutMs: number = SITEMINDER_TIMEOUT_MS): Post {
  const post = async (xml: string) => {
    const res = await fetch(url(), {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", Accept: "text/xml" },
      body: xml,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, body: await res.text() };
  };
  return Object.assign(post, { timeoutMs });
}

const reservationFromEnv = (): ReservationConfig => ({
  requestorId: env.requestorId,
  credentials: { username: env.reservationUsername, password: env.reservationPassword },
});

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// ---------------------------------------------------------------------------------------------------------------
// SiteMinder's answer

/**
 * Error Warning Types that mean "fix the message or the setup first": 4 authentication (credentials,
 * guides_error-handling.md:180), 6 authorization (hotel not found / no hotel code, :193), 10 required field
 * missing (:224, "must be adjusted", :235), and, as the schema/validation errors of reference_reservations.md:1687
 * ("XML/Format Issues": invalid structure, data types or formats), 3 business rule and 7 protocol violation.
 * The docs say not to resend a message with an Error until it is fixed (guides_error-handling.md:158); any other
 * type is still retried, as the controller ruled (unknown types may be SiteMinder-side trouble).
 */
const PERMANENT_ERROR_TYPES = new Set(["3", "4", "6", "7", "10"]);
const FORBIDDEN_DECLARATION = /<!\s*(DOCTYPE|ENTITY)/i;

function unreadable(reason: string, xml: string): Result {
  console.warn(`[siteminder] ${reason}; will retry`, { reply: xml.slice(0, 500) });
  return { ok: false, permanent: false, error: reason };
}

/**
 * An `OTA_HotelResNotifRS` (in its SOAP envelope or bare) as a delivery result: `Success` -> ok; `Errors` ->
 * permanent when any error is of a permanent type (credentials, hotel, validation), else transient; a reply
 * that is not such a message -> transient (logged).
 */
export function classifyReply(xml: string): Result {
  if (FORBIDDEN_DECLARATION.test(xml) || XMLValidator.validate(xml) !== true) return unreadable("SiteMinder sent a reply that is not well-formed XML", xml);
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return unreadable("SiteMinder sent a reply that is not well-formed XML", xml);
  }
  const envelope = isRecord(parsed) && isRecord(parsed.Envelope) ? parsed.Envelope : undefined;
  const body = envelope && isRecord(envelope.Body) ? envelope.Body : parsed;
  const rs = isRecord(body) ? body.OTA_HotelResNotifRS : undefined;
  if (!isRecord(rs)) return unreadable("SiteMinder sent a reply without OTA_HotelResNotifRS", xml);

  const errors = asArray(isRecord(rs.Errors) ? rs.Errors.Error : undefined).map((e) => ({
    type: isRecord(e) && typeof e["@_Type"] === "string" ? e["@_Type"] : "",
    text: typeof e === "string" ? e : isRecord(e) && typeof e["#text"] === "string" ? e["#text"] : "",
  }));
  if (errors.length > 0) {
    return {
      ok: false,
      permanent: errors.some((e) => PERMANENT_ERROR_TYPES.has(e.type)),
      error: errors.map((e) => `SiteMinder error Type ${e.type || "?"}: ${e.text}`).join("; "),
    };
  }
  if ("Success" in rs) return { ok: true };
  return unreadable("SiteMinder sent an OTA_HotelResNotifRS with neither Success nor Errors", xml);
}

/**
 * The HTTP answer as a result. 4xx is permanent (guides_error-handling.md:244: "These errors should not be
 * retried, as resending the same message will continue to fail"), except 408/429 (a timeout or rate limit passes);
 * 5xx is transient (:248).
 */
function resultOf(res: { status: number; body: string }): Result {
  if (res.status >= 200 && res.status < 300) return classifyReply(res.body);
  const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
  return { ok: false, permanent, error: `SiteMinder answered HTTP ${res.status}` };
}

// ---------------------------------------------------------------------------------------------------------------
// The outbox rows

type DbRow = {
  booking_id: string;
  latest: AppBooking;
  latest_version: string;
  acked: OutboxRow["acked"];
  acked_version: string | null;
  status: OutboxRow["status"];
  attempts: number;
  acked_at: Date | null;
  first_failed_at: Date | null;
  report: DeliveryReport | null;
};
const COLUMNS = `booking_id, latest, latest_version::text AS latest_version, acked, acked_version::text AS acked_version, status, attempts, acked_at, first_failed_at, report`;

const stateOf = (r: DbRow): OutboxRow => ({
  acked: r.acked,
  ackedVersion: r.acked_version === null ? null : Number(r.acked_version),
  latest: r.latest,
  latestVersion: Number(r.latest_version),
  status: r.status,
  attempts: r.attempts,
});

/**
 * Installations with bookings to send (`waiting`, a retry whose time has come, or a send whose claim ran out)
 * or reports core has not had yet: the tick's pending work besides the inbox.
 */
export async function installationsWithDueDeliveries(db: Queryable, now: Date): Promise<Set<string>> {
  const { rows } = await db.query<{ installation_id: string }>(
    `SELECT DISTINCT o.installation_id FROM siteminder.outbox o JOIN siteminder.installations i ON i.id = o.installation_id
      WHERE i.status = 'active'
        AND (o.report_pending OR o.status = 'waiting' OR (o.status IN ('retrying', 'sending') AND o.next_attempt_at <= $1::timestamptz))`,
    [now.toISOString()],
  );
  return new Set(rows.map((r) => r.installation_id));
}

/**
 * Take the next due booking of the installation for one send: 'sending' with our token, held until the claim
 * runs out. Waiting rows first, then retries by due time, so a booking that keeps failing never holds up others.
 */
async function claimNext(db: Queryable, installationId: string, token: string, now: Date, holdMs: number): Promise<DbRow | null> {
  const { rows } = await db.query<DbRow>(
    // A scalar subquery runs once; a LIMIT 1 subquery joined in FROM may be rescanned and claim several rows.
    `UPDATE siteminder.outbox
        SET status = 'sending', claim_token = $3, next_attempt_at = $4, updated_at = $2
      WHERE installation_id = $1
        AND booking_id = (SELECT booking_id FROM siteminder.outbox
                           WHERE installation_id = $1
                             AND (status = 'waiting' OR (status IN ('retrying', 'sending') AND next_attempt_at <= $2::timestamptz))
                           ORDER BY next_attempt_at NULLS FIRST, updated_at, booking_id
                           LIMIT 1
                           FOR UPDATE SKIP LOCKED)
      RETURNING ${COLUMNS}`,
    [installationId, now.toISOString(), token, new Date(now.getTime() + holdMs).toISOString()],
  );
  return rows[0] ?? null;
}

/** When the installation's next retry is due, if any. */
async function nextRetryAt(db: Queryable, installationId: string): Promise<Date | null> {
  const { rows } = await db.query<{ wake: Date | null }>(
    `SELECT min(next_attempt_at) AS wake FROM siteminder.outbox WHERE installation_id = $1 AND status = 'retrying'`,
    [installationId],
  );
  return rows[0]?.wake ?? null;
}

/** The row's state after this send (or decision not to send), and the report core should get, if it changed. */
type Decision = {
  status: OutboxRow["status"];
  acked: OutboxRow["acked"];
  ackedVersion: number | null;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  /** Set on a success; null keeps the stored time. */
  ackedAt: Date | null;
  /** When the current message first failed (transiently or not); null once it succeeded. Written as is. */
  firstFailedAt: Date | null;
  report: DeliveryReport | null;
};

function reportFor(status: OutboxRow["status"], version: number, ackedAt: Date | null, detail: string | null): DeliveryReport | null {
  if (status === "delivered") return { status: "delivered", acknowledgedAt: ackedAt?.toISOString() ?? null, detail: null, version };
  if (status === "retrying") return { status: "retrying", acknowledgedAt: null, detail, version };
  if (status === "needs_attention") return { status: "needs_attention", acknowledgedAt: null, detail, version };
  return null;
}

/** Only a state change goes to core: a different status, or the same status for another version. */
const changed = (fresh: DbRow, report: DeliveryReport | null) =>
  report !== null && (fresh.report?.status !== report.status || fresh.report?.version !== report.version) ? report : null;

/** After a send, decided on the FRESH row: a newer version that arrived meanwhile keeps the row 'waiting'. */
function afterSend(fresh: DbRow, sent: Sent, result: Result, sentVersion: number, at: Date): Decision {
  const state = stateOf(fresh);
  const firstFailedAt = result.ok ? null : (fresh.first_failed_at ?? at);
  const failingForSeconds = firstFailedAt === null ? 0 : Math.max(0, (at.getTime() - firstFailedAt.getTime()) / 1000);
  const out = afterResult(state, sent, result, sentVersion, failingForSeconds);
  let status = out.status;
  let lastError = result.ok ? null : result.error;
  let version = sentVersion;
  if (status === "waiting") {
    // Acked, but more to do. A reopen after the Cancel just acked is not something to send: tell the hotel.
    const next = nextMessage({ ...state, ...out });
    if ("needsAttention" in next) {
      status = "needs_attention";
      lastError = next.needsAttention;
      version = state.latestVersion;
    }
  }
  const nextAttemptAt = status === "retrying" && out.retryInSeconds !== null ? new Date(at.getTime() + out.retryInSeconds * 1000) : null;
  const report = reportFor(status, version, result.ok ? at : fresh.acked_at, lastError);
  return { ...out, status, nextAttemptAt, lastError, ackedAt: result.ok ? at : null, firstFailedAt, report: changed(fresh, report) };
}

/** A claimed row with nothing to send (any more): settle it from the fresh row. */
function withoutSend(fresh: DbRow): Decision {
  const state = stateOf(fresh);
  const next = nextMessage(state);
  const keep = { acked: state.acked, ackedVersion: state.ackedVersion, attempts: state.attempts, nextAttemptAt: null, ackedAt: null, firstFailedAt: fresh.first_failed_at };
  if ("needsAttention" in next) {
    return { ...keep, status: "needs_attention", lastError: next.needsAttention, report: changed(fresh, reportFor("needs_attention", state.latestVersion, null, next.needsAttention)) };
  }
  if (next.send !== "none") return { ...keep, status: "waiting", lastError: null, report: null }; // a newer version came in
  // SiteMinder has everything that matters for the latest version (e.g. a newer version of a booking whose Cancel
  // was acked; reference_reservations.md:131: Cancel is terminal). Report it delivered at that version: core
  // stores a delivered report for an older version than its current one as `pending` (packages/db/src/apps/
  // delivery.ts, recordDelivery), so the acked version would leave the booking pending for ever.
  return { ...keep, status: "delivered", lastError: null, report: changed(fresh, reportFor("delivered", state.latestVersion, fresh.acked_at, null)) };
}

/**
 * Write the decision back if the claim is still ours and the row did not change since it was read (compare and
 * set on latest_version); else read it again and decide again. Null when the claim was lost (it ran out).
 */
async function settle(db: Queryable, installationId: string, bookingId: string, token: string, now: () => Date, decide: (fresh: DbRow) => Decision): Promise<Decision | null> {
  for (let round = 0; round < 10; round++) {
    const { rows } = await db.query<DbRow>(
      `SELECT ${COLUMNS} FROM siteminder.outbox WHERE installation_id = $1 AND booking_id = $2 AND claim_token = $3`,
      [installationId, bookingId, token],
    );
    const fresh = rows[0];
    if (!fresh) return null;
    const d = decide(fresh);
    const written = await db.query(
      `UPDATE siteminder.outbox
          SET status = $5, acked = $6, acked_version = $7, attempts = $8, next_attempt_at = $9, last_error = $10,
              acked_at = COALESCE($11::timestamptz, acked_at),
              first_failed_at = $14::timestamptz,
              report = COALESCE($12::jsonb, report),
              report_pending = report_pending OR $12::jsonb IS NOT NULL,
              claim_token = NULL, updated_at = $13
        WHERE installation_id = $1 AND booking_id = $2 AND claim_token = $3 AND latest_version = $4
        RETURNING booking_id`,
      [
        installationId,
        bookingId,
        token,
        fresh.latest_version,
        d.status,
        d.acked,
        d.ackedVersion,
        d.attempts,
        d.nextAttemptAt?.toISOString() ?? null,
        d.lastError,
        d.ackedAt?.toISOString() ?? null,
        d.report === null ? null : JSON.stringify(d.report),
        now().toISOString(),
        d.firstFailedAt?.toISOString() ?? null,
      ],
    );
    if (written.rows.length > 0) return d;
  }
  throw new Error(`outbox row of booking ${bookingId} kept changing; left for the next tick`);
}

// ---------------------------------------------------------------------------------------------------------------
// Delivering

type Ctx = {
  deps: TickDeps & { post: Post };
  inst: AppInstallation;
  client: CoreClient;
  reservation: ReservationConfig;
  renew: (holdMs: number) => Promise<boolean>;
  budget: { left: () => number };
  counts: DeliveryCounts;
};

/** Tell core; on success clear the pending mark unless a newer report replaced it meanwhile. False: try later. */
async function sendReport(ctx: Ctx, bookingId: string, report: DeliveryReport): Promise<boolean> {
  if (!(await ctx.renew(0))) return false;
  const context = { installationId: ctx.inst.id, propertyCode: ctx.inst.propertyCode, bookingId, report };
  try {
    await ctx.client.reportDelivery(bookingId, report);
  } catch (e) {
    // Core will never take this one (unknown booking, refused body): drop it rather than retry for ever.
    const never = e instanceof UnknownBookingError || (e instanceof CoreApiError && e.kind === "bad_request");
    if (!never) {
      console.warn("[siteminder] reporting a delivery to core failed; the next tick tries again", { ...context, error: errorText(e) });
      return false;
    }
    console.error("[siteminder] core refused a delivery report; it will not be sent again", { ...context, error: errorText(e) });
  }
  await ctx.deps.db.query(
    `UPDATE siteminder.outbox SET report_pending = false WHERE installation_id = $1 AND booking_id = $2 AND report = $3::jsonb`,
    [ctx.inst.id, bookingId, JSON.stringify(report)],
  );
  return true;
}

/** Reports a previous tick could not get to core. Stops at the first failure: core is likely down. */
async function flushPendingReports(ctx: Ctx): Promise<void> {
  const { rows } = await ctx.deps.db.query<{ booking_id: string; report: DeliveryReport }>(
    `SELECT booking_id, report FROM siteminder.outbox WHERE installation_id = $1 AND report_pending ORDER BY updated_at, booking_id LIMIT ${REPORTS_PER_ROUND}`,
    [ctx.inst.id],
  );
  for (const r of rows) {
    if (ctx.budget.left() <= 0 || !(await sendReport(ctx, r.booking_id, r.report))) return;
  }
}

/** One message to SiteMinder. A booking the builder refuses is a permanent failure: resending cannot fix it. */
async function send(ctx: Ctx, booking: AppBooking, status: Sent): Promise<Result> {
  let xml: string;
  try {
    xml = buildResNotif({
      booking,
      status,
      requestorId: ctx.reservation.requestorId,
      hotelCode: ctx.inst.propertyCode,
      credentials: ctx.reservation.credentials,
      echoToken: randomUUID(),
      now: ctx.deps.now(),
    });
  } catch (e) {
    return { ok: false, permanent: true, error: `could not build the reservation: ${errorText(e)}` };
  }
  try {
    return resultOf(await ctx.deps.post(xml));
  } catch (e) {
    return { ok: false, permanent: false, error: `no answer from SiteMinder: ${errorText(e)}` };
  }
}

/** Send what the claimed row needs (or settle it without a send), store the outcome, then tell core. */
async function deliverOne(ctx: Ctx, claimed: DbRow, token: string): Promise<void> {
  const { deps, inst } = ctx;
  const state = stateOf(claimed);
  const next = nextMessage(state);
  let decision: Decision | null;
  if ("needsAttention" in next || next.send === "none") {
    decision = await settle(deps.db, inst.id, claimed.booking_id, token, deps.now, withoutSend);
  } else {
    const sent = next.send;
    const sentVersion = state.latestVersion;
    const result = await send(ctx, next.booking, sent);
    const at = deps.now();
    decision = await settle(deps.db, inst.id, claimed.booking_id, token, deps.now, (fresh) => afterSend(fresh, sent, result, sentVersion, at));
  }

  const context = { installationId: inst.id, propertyCode: inst.propertyCode, bookingId: claimed.booking_id };
  if (!decision) {
    console.warn("[siteminder] a booking's send outlived its claim; another tick took it over", context);
    return;
  }
  if (decision.status === "delivered") ctx.counts.delivered += 1;
  if (decision.status === "retrying") {
    ctx.counts.retrying += 1;
    // Hotels hear of it only after the 30-minute window (needs_attention); we hear of an outage after ~2 minutes.
    if (decision.attempts === ALERT_AFTER_FAILURES) {
      alert("error", `a booking failed ${ALERT_AFTER_FAILURES} times in a row delivering to SiteMinder; still retrying`, { ...context, error: decision.lastError });
    }
  }
  if (decision.status === "needs_attention") {
    ctx.counts.needsAttention += 1;
    alert("error", "a booking could not be delivered to SiteMinder and needs attention", { ...context, error: decision.lastError });
  }
  if (decision.report) await sendReport(ctx, claimed.booking_id, decision.report);
}

/**
 * One installation: reports still owed to core first, then every due booking, one message at a time (SiteMinder
 * wants each answer before the next request for a site), sleeping for a retry while the budget allows.
 */
async function deliverInstallation(ctx: Ctx): Promise<void> {
  const { deps, inst } = ctx;
  const sendMs = deps.post.timeoutMs;
  await flushPendingReports(ctx);
  for (;;) {
    // A send starts only when the budget can hold its whole timeout; otherwise the next tick takes it.
    if (ctx.budget.left() < sendMs || !(await ctx.renew(sendMs))) return;
    const token = randomUUID();
    const claimed = await claimNext(deps.db, inst.id, token, deps.now(), sendMs + CLAIM_MARGIN_MS);
    if (claimed) {
      await deliverOne(ctx, claimed, token);
      continue;
    }
    const wake = await nextRetryAt(deps.db, inst.id);
    if (!wake) return;
    const wait = wake.getTime() - deps.now().getTime();
    // wait <= 0: due but not claimable (another tick has it): leave it to that tick. Wait only when the send
    // after the wait still fits the budget (retry waits are at most 60 s; longer gaps are the ticks').
    if (wait <= 0 || wait + sendMs > ctx.budget.left()) return;
    if (!(await ctx.renew(wait + sendMs))) return;
    await deps.sleep(wait);
  }
}

/**
 * Deliver due bookings to SiteMinder: `waiting` rows and retries whose time has come, for every active
 * installation (or only `installationId`), and report each state change to core. Installations run in parallel,
 * bookings of one installation one after another. A send starts only while `budgetMs` can still hold its whole
 * timeout; a retry that falls later stays in `next_attempt_at` for the next tick. Transient failures are retried
 * for 30 minutes from the first one (core hears `retrying` once, we alert at the 5th failure in a row), then the
 * booking needs attention. The tick runs this under the installation's lease and passes `renewLease`, called with
 * the time about to be spent before each call out and each sleep.
 */
export async function deliverDue(
  deps: TickDeps & { post: Post },
  i: { budgetMs: number; installationId?: string; renewLease?: (holdMs: number) => Promise<boolean> },
): Promise<DeliveryCounts> {
  const start = deps.now().getTime();
  const budget = { left: () => i.budgetMs - (deps.now().getTime() - start) };
  const counts: DeliveryCounts = { delivered: 0, retrying: 0, needsAttention: 0 };
  const reservation = deps.reservation ?? reservationFromEnv();
  const renew = i.renewLease ?? (async () => true);
  const installations = (await activeInstallations(deps.db)).filter((inst) => i.installationId === undefined || inst.id === i.installationId);
  await Promise.all(
    installations.map(async (inst) => {
      try {
        await deliverInstallation({ deps, inst, client: deps.client(inst), reservation, renew, budget, counts });
      } catch (e) {
        console.error("[siteminder] delivering bookings failed for an installation", { installationId: inst.id, propertyCode: inst.propertyCode, error: errorText(e) });
      }
    }),
  );
  return counts;
}
