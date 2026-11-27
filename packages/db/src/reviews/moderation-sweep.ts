/**
 * The moderation job (0061), run every 15 minutes by
 * /api/cron/review-moderation. In this order:
 *
 *   1. recheck   held items the model couldn't check (it failed or timed
 *                out) go through the check again: clean publishes, anything
 *                else stays held with what was found.
 *   2. deadline  held items nobody decided within 72 hours publish with their
 *                flagged fragments masked. After the recheck, so an item the
 *                model can now read publishes with its fragments known.
 *   3. purge     reports and the original text of removed or masked items go
 *                12 months after the decision.
 *
 * The check is the caller's (`check`: @openbookings/moderation's checkText),
 * so this package doesn't know about the model. Safe to run at any time, as
 * often as wanted: every write is compare-and-set.
 */
import type { TextCheck } from "@openbookings/pricing";
import type { Queryable } from "../reservation-policy";
import { applyRecheck, publishOverdue, purgeModerationRecords, uncheckedItems, type ModerationItem } from "./moderation";

/** Rechecks per run, oldest first. At the check's 3-second timeout, a run stays under two minutes. */
const RECHECKS_PER_RUN = 25;

export type ModerationSweepDeps = {
  db: Queryable;
  now: Date;
  /** The moderation check: the text alone. */
  check: (text: string) => Promise<TextCheck>;
  /** Told about every recheck that failed; the others still run. */
  onError?: (error: unknown, context: ModerationItem) => void;
};

export type ModerationSweepSummary = {
  /** Unchecked items the check could now read, and stored. */
  rechecked: number;
  /** Held items published by the deadline. */
  published: number;
  purged: { reports: number; texts: number };
  /** Properties whose public reviews changed in this run: their cached pages are stale. */
  propertyIds: string[];
};

export async function runModerationSweep(deps: ModerationSweepDeps): Promise<ModerationSweepSummary> {
  const { db, now } = deps;
  const propertyIds = new Set<string>();

  let rechecked = 0;
  for (const item of await uncheckedItems(db, RECHECKS_PER_RUN)) {
    const ref: ModerationItem = { kind: item.kind, id: item.id };
    try {
      // With the text that was checked: if it changed meanwhile, this check is stale.
      const result = await applyRecheck(db, { ...ref, body: item.body }, await deps.check(item.body), now);
      if (result.stored) rechecked++;
      if (result.publishedPropertyId) propertyIds.add(result.publishedPropertyId);
    } catch (error) {
      deps.onError?.(error, ref);
    }
  }

  const deadline = await publishOverdue(db, now);
  for (const id of deadline.propertyIds) propertyIds.add(id);

  const purged = await purgeModerationRecords(db, now);
  return { rechecked, published: deadline.published, purged, propertyIds: [...propertyIds] };
}
