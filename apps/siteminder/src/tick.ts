import { randomUUID } from "node:crypto";
import { type AriBatch, MAX_ARI_CHANGES } from "@openbookings/apps-contract";
import { alert, errorText } from "./alert";
import { CORE_TIMEOUT_MS, CoreApiError, coreClient } from "./core-client";
import type { Queryable } from "./db/migrate";
import { getPool } from "./db/pool";
import {
  type DeliveryCounts,
  type Post,
  type ReservationConfig,
  SITEMINDER_TIMEOUT_MS,
  deliverDue,
  installationsWithDueDeliveries,
  reservationPoster,
} from "./deliver";
import {
  type PendingMessage,
  headIsDue,
  inboxHealth,
  installationsWithPending,
  markApplied,
  markFailed,
  pendingMessages,
  scheduleRetry,
} from "./inbox";
import { env } from "./env";
import { type AppInstallation, activeInstallations } from "./installations";
import { dueForPoll } from "./outbox-store";
import { dayNumber } from "./ota/status-control";
import { pollInstallation } from "./poll";
import { ALERT_AFTER_FAILURES, retryDelaySeconds } from "./retry";

export type TickDeps = {
  db: Queryable;
  client: (inst: AppInstallation) => ReturnType<typeof coreClient>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** How often to ask core for booking changes. Unset: the tick does not poll core. */
  pollSeconds?: number;
  /** SiteMinder's reservation endpoint. Unset: the tick does not deliver bookings. */
  post?: Post;
  /** RequestorID and credentials for SiteMinder; from the environment when unset. */
  reservation?: ReservationConfig;
};

/**
 * `inboxFailed` counts messages whose send failed in this tick, whether retried later or given up. `delivery`
 * (when the tick delivers) counts bookings that ended delivered, retrying or needing attention in this tick.
 */
export type TickResult = { inboxApplied: number; inboxFailed: number; delivery?: DeliveryCounts };

/** Nights one POST may expand to in core (sum over its changes of the days from..to), next to MAX_ARI_CHANGES. */
export const MAX_BATCH_NIGHTS = 50_000;
export const STALE_INBOX_SECONDS = 10 * 60;
/**
 * When new work may start. It fits one full SiteMinder send (60 s timeout) after other work: a send only starts
 * while the remaining budget can hold its whole timeout. A tick can run past it by at most one core call.
 */
export const DEFAULT_BUDGET_MS = 120_000;

// A lease outlives any single call out (core or SiteMinder); it is renewed before each one.
const LEASE_MS = Math.max(CORE_TIMEOUT_MS, SITEMINDER_TIMEOUT_MS) + 60_000;
const MESSAGES_PER_ROUND = 200;

export function defaultTickDeps(): TickDeps {
  return {
    db: getPool(),
    client: (inst) => coreClient(inst),
    now: () => new Date(),
    sleep: (ms) => Bun.sleep(ms),
    pollSeconds: env.pollSeconds,
    post: reservationPoster(() => env.reservationUrl),
  };
}


// ---------------------------------------------------------------------------------------------------------------
// Batching

export type Pack = {
  batch: AriBatch;
  /** Messages with changes in this batch, in order (the first and last may be split across neighbouring batches). */
  messageIds: string[];
  /** Messages whose last change is in this batch: done once it is in. */
  completes: string[];
};

const KINDS = ["inventory", "rates", "restrictions"] as const;
const nightsOf = (c: { from: string; to: string }) => dayNumber(c.to) - dayNumber(c.from) + 1;

/**
 * Consecutive messages merged into batches of at most MAX_ARI_CHANGES changes and MAX_BATCH_NIGHTS nights, in
 * order. A message too big for one batch continues in the next. Without `merge`, every message gets batches of
 * its own (to find the one core refuses). `receivedAt` is the earliest receipt among the batch's messages.
 */
export function packBatches(messages: PendingMessage[], merge: boolean): Pack[] {
  type Open = Pack & { changes: number; nights: number; earliest: number };
  const packs: Open[] = [];
  let current: Open | undefined;
  const open = (): Open => {
    current = { batch: { inventory: [], rates: [], restrictions: [] }, messageIds: [], completes: [], changes: 0, nights: 0, earliest: Number.POSITIVE_INFINITY };
    packs.push(current);
    return current;
  };
  const join = (pack: Open, m: PendingMessage) => {
    if (pack.messageIds.at(-1) === m.id) return;
    pack.messageIds.push(m.id);
    pack.earliest = Math.min(pack.earliest, m.receivedAt.getTime());
  };

  for (const m of messages) {
    if (!merge) current = undefined;
    for (const kind of KINDS) {
      for (const change of m.changes[kind] ?? []) {
        const nights = nightsOf(change);
        let pack = current;
        if (!pack || pack.changes + 1 > MAX_ARI_CHANGES || pack.nights + nights > MAX_BATCH_NIGHTS) pack = open();
        (pack.batch[kind] as unknown[]).push(change);
        pack.changes += 1;
        pack.nights += nights;
        join(pack, m);
      }
    }
    const last = current ?? open(); // a message without changes still has to be marked done
    join(last, m);
    last.completes.push(m.id);
  }
  return packs.map(({ batch, messageIds, completes, earliest }) => ({
    batch: { ...batch, receivedAt: new Date(earliest).toISOString() },
    messageIds,
    completes,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Per-installation lease: one tick at a time sends an installation's messages, so they reach core in order.

async function claimLease(db: Queryable, installationId: string, now: Date): Promise<string | null> {
  const token = randomUUID();
  const { rows } = await db.query(
    `UPDATE siteminder.installations SET inbox_lease_token = $2, inbox_lease_until = $3
      WHERE id = (SELECT id FROM siteminder.installations
                   WHERE id = $1 AND status = 'active' AND (inbox_lease_until IS NULL OR inbox_lease_until <= $4)
                   FOR UPDATE SKIP LOCKED)
      RETURNING id`,
    [installationId, token, new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString()],
  );
  return rows.length > 0 ? token : null;
}

async function renewLease(db: Queryable, installationId: string, token: string, until: Date): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE siteminder.installations SET inbox_lease_until = $3 WHERE id = $1 AND inbox_lease_token = $2 RETURNING id`,
    [installationId, token, until.toISOString()],
  );
  return rows.length > 0;
}

async function releaseLease(db: Queryable, installationId: string, token: string): Promise<void> {
  await db.query(
    `UPDATE siteminder.installations SET inbox_lease_token = NULL, inbox_lease_until = NULL WHERE id = $1 AND inbox_lease_token = $2`,
    [installationId, token],
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Sending

type Outcome = { ok: true } | { ok: false; retryable: boolean; error: string; unknownCodes?: string[] };

async function send(client: ReturnType<typeof coreClient>, pack: Pack): Promise<Outcome> {
  const { inventory, rates, restrictions } = pack.batch;
  if (inventory.length + rates.length + restrictions.length === 0) return { ok: true };
  try {
    const result = await client.writeAri(pack.batch);
    if (result.ok) return { ok: true };
    return { ok: false, retryable: false, error: `${result.error}: ${result.unknownCodes.join(", ")}`, unknownCodes: result.unknownCodes };
  } catch (e) {
    // Anything but a known permanent answer may pass: try again.
    return { ok: false, retryable: e instanceof CoreApiError ? e.retryable : true, error: errorText(e) };
  }
}

type Budget = { left: () => number };

/** Send the installation's due messages in order while the lease holds and the budget lasts; short retry waits inline. */
async function drain(deps: TickDeps, inst: AppInstallation, token: string, budget: Budget, counts: TickResult): Promise<void> {
  const client = deps.client(inst);
  const context = { installationId: inst.id, propertyCode: inst.propertyCode };
  let merge = true;
  for (;;) {
    const messages = await pendingMessages(deps.db, inst.id, MESSAGES_PER_ROUND);
    const head = messages[0];
    if (!head) return;
    const now = deps.now();

    // Later messages never overtake the oldest: wait for its retry here if the budget allows, else leave it.
    if (head.nextAttemptAt && head.nextAttemptAt > now) {
      const wait = head.nextAttemptAt.getTime() - now.getTime();
      if (wait >= budget.left()) return;
      if (!(await renewLease(deps.db, inst.id, token, new Date(now.getTime() + wait + LEASE_MS)))) return;
      await deps.sleep(wait);
      continue;
    }
    const notDue = messages.findIndex((m) => m.nextAttemptAt !== null && m.nextAttemptAt > now);
    const due = notDue === -1 ? messages : messages.slice(0, notDue);

    for (const pack of packBatches(due, merge)) {
      if (budget.left() <= 0) return;
      if (!(await renewLease(deps.db, inst.id, token, new Date(deps.now().getTime() + LEASE_MS)))) return;
      const outcome = await send(client, pack);
      const at = deps.now();
      if (outcome.ok) {
        await markApplied(deps.db, pack.completes, at);
        counts.inboxApplied += pack.completes.length;
        continue;
      }
      if (!outcome.retryable && pack.messageIds.length > 1) {
        // Core refused a merged batch for good: resend one message per batch to set aside only the culprit.
        merge = false;
        break;
      }
      counts.inboxFailed += pack.messageIds.length;
      if (!outcome.retryable) {
        await markFailed(deps.db, pack.messageIds, outcome.error, at);
        const extra = { ...context, messageIds: pack.messageIds, error: outcome.error };
        if (outcome.unknownCodes) console.warn("[siteminder] core refused an inbox message for unknown codes", { ...extra, unknownCodes: outcome.unknownCodes });
        else alert("error", "core refused an inbox message for good; it will not be retried", extra);
        break;
      }
      const attempts = Math.max(...due.filter((m) => pack.messageIds.includes(m.id)).map((m) => m.attempts)) + 1;
      const delaySeconds = retryDelaySeconds(attempts);
      await scheduleRetry(deps.db, pack.messageIds, outcome.error, new Date(at.getTime() + delaySeconds * 1000));
      if (attempts === ALERT_AFTER_FAILURES) {
        alert("error", `inbox message failed ${attempts} times; still retrying every ${delaySeconds} s`, { ...context, messageIds: pack.messageIds, error: outcome.error });
      }
      break;
    }
  }
}

/**
 * Booking changes from core into the outbox, under the installation's lease (one poller at a time, so cursor
 * and pages stay in order). A core error leaves the cursor where it was and does not stop the inbox work.
 */
async function poll(deps: TickDeps, inst: AppInstallation, token: string, budget: Budget): Promise<void> {
  try {
    await pollInstallation(deps, inst, async () => budget.left() > 0 && (await renewLease(deps.db, inst.id, token, new Date(deps.now().getTime() + LEASE_MS))));
  } catch (e) {
    alert("warning", "polling core for booking changes failed; will try again", { installationId: inst.id, propertyCode: inst.propertyCode, error: errorText(e) });
  }
}

const renewLeaseFor = (deps: TickDeps, installationId: string, token: string, holdMs: number) =>
  renewLease(deps.db, installationId, token, new Date(deps.now().getTime() + holdMs + LEASE_MS));

/** Bookings out to SiteMinder under the installation's lease, renewed before each call out and each retry wait. */
async function deliver(deps: TickDeps, inst: AppInstallation, token: string, budget: Budget, counts: TickResult): Promise<void> {
  const post = deps.post;
  if (!post || !counts.delivery) return;
  const renewLease = (holdMs: number) => renewLeaseFor(deps, inst.id, token, holdMs);
  const done = await deliverDue({ ...deps, post }, { budgetMs: budget.left(), installationId: inst.id, renewLease });
  counts.delivery.delivered += done.delivered;
  counts.delivery.retrying += done.retrying;
  counts.delivery.needsAttention += done.needsAttention;
}

async function processInstallation(deps: TickDeps, inst: AppInstallation, budget: Budget, counts: TickResult, polling: boolean): Promise<void> {
  for (;;) {
    const token = await claimLease(deps.db, inst.id, deps.now());
    if (!token) return; // another tick is on it
    try {
      if (polling) {
        await poll(deps, inst, token, budget);
        polling = false; // the look-again loop below is for inbox messages only
      }
      await drain(deps, inst, token, budget, counts);
      await deliver(deps, inst, token, budget, counts);
    } finally {
      await releaseLease(deps.db, inst.id, token);
    }
    // A message stored while we held the lease had its own tick turned away: look again before leaving.
    if (budget.left() <= 0 || !(await headIsDue(deps.db, inst.id, deps.now()))) return;
  }
}

/**
 * All background work, idempotent and safe to run concurrently. Inbound: each active installation's unprocessed
 * messages (or only `installationId`'s), in arrival order, merged into batches and written to core. Outbound
 * (with `post`): booking changes polled from core, then due bookings delivered to SiteMinder and their state
 * reported to core. Installations run in parallel; within one, a lease keeps a single tick at work. `budgetMs`
 * bounds when new work may start.
 */
export async function tick(deps: TickDeps, i: { installationId?: string; budgetMs?: number } = {}): Promise<TickResult> {
  const counts: TickResult = { inboxApplied: 0, inboxFailed: 0, ...(deps.post ? { delivery: { delivered: 0, retrying: 0, needsAttention: 0 } } : {}) };
  const start = deps.now().getTime();
  const budgetMs = i.budgetMs ?? DEFAULT_BUDGET_MS;
  const budget: Budget = { left: () => budgetMs - (deps.now().getTime() - start) };

  const active = await activeInstallations(deps.db);
  const pending = i.installationId ? new Set([i.installationId]) : await installationsWithPending(deps.db);
  // Due deliveries count as pending work, so retries and unsent reports go out between polls too.
  if (deps.post && !i.installationId) for (const id of await installationsWithDueDeliveries(deps.db, deps.now())) pending.add(id);
  // Polling: every installation whose last poll is old enough, and the requested one right away (the doorbell).
  const polls = deps.pollSeconds === undefined ? new Set<string>() : await dueForPoll(deps.db, deps.now(), deps.pollSeconds);
  if (deps.pollSeconds !== undefined && i.installationId) polls.add(i.installationId);
  await Promise.all(
    active
      .filter((inst) => pending.has(inst.id) || polls.has(inst.id))
      .map(async (inst) => {
        try {
          await processInstallation(deps, inst, budget, counts, polls.has(inst.id));
        } catch (e) {
          alert("error", "tick failed for an installation", { installationId: inst.id, propertyCode: inst.propertyCode, error: errorText(e) });
        }
      }),
  );

  if (!i.installationId) {
    const health = await inboxHealth(deps.db, deps.now());
    if (health.oldestUnprocessedSeconds > STALE_INBOX_SECONDS) {
      alert("warning", `oldest unprocessed inbox message is ${health.oldestUnprocessedSeconds} s old`, health);
    }
  }
  return counts;
}
