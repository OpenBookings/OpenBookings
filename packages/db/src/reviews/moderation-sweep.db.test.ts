/**
 * The moderation cron (runModerationSweep) against Postgres: the recheck of
 * items the model missed, the 72-hour deadline after it, and which
 * properties' pages it says to refresh.
 *
 * Each test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { TextCheck } from "@openbookings/pricing";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";
import { postReviewReply, submitReview } from "./index";
import { publishOverdue, type ModerationItem } from "./moderation";
import { runModerationSweep } from "./moderation-sweep";

const HOUR = 3_600_000;
const CHECK_IN = "2031-11-10";
/** Two days after the stays' check-out: when the reviews in these tests are written. */
const WRITTEN = new Date(Date.parse("2031-11-12T10:00:00Z") + 48 * HOUR);
const later = (ms: number) => new Date(WRITTEN.getTime() + ms);

const CLEAN: TextCheck = { verdict: "clean", rules: [], fragments: [], source: "mistral" };
const UNCHECKED: TextCheck = { verdict: "unchecked", rules: [], fragments: [], source: "regex" };
const NAMED: TextCheck = { verdict: "flagged", rules: ["personal_details"], fragments: ["Jan Jansen"], source: "mistral" };
const RUDE = "Jan Jansen at the desk was rude to us.";
const MAILED = "Mail anna@example.com for the best tips.";
/** What the check says when the model is down but the regex found a contact detail. */
const REGEX_ONLY: TextCheck = { verdict: "unchecked", rules: ["links_contact"], fragments: ["anna@example.com"], source: "regex" };

describeWithDb("the moderation sweep against Postgres", () => {
  let db: Client;
  let ids: Awaited<ReturnType<typeof seedProperty>>;

  const row = async (table: "reviews" | "review_replies", id: string) =>
    (
      await db.query(
        `SELECT status, masked_body, flagged_reason, flagged_fragments, check_source, published_by_deadline FROM ${table} WHERE id = $1`,
        [id],
      )
    ).rows[0] as Record<string, unknown>;

  /** A review of a finished stay, written at `now` (WRITTEN) with `check`'s outcome. */
  async function review(body: string, check: TextCheck, now = WRITTEN): Promise<ModerationItem> {
    const { bookingId } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
    const result = await submitReview(db, { bookingId, via: "session", score: 7, body, check, now });
    if (!result.ok) throw new Error(`review failed: ${result.error}`);
    return { kind: "review", id: result.reviewId };
  }

  /** The model's answer per text, as the check would give it; anything else is unchecked. */
  const answers =
    (byText: Record<string, TextCheck>) =>
    async (text: string): Promise<TextCheck> =>
      byText[text] ?? UNCHECKED;

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
    ids = await seedProperty(db);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("rechecks unchecked items and publishes the clean ones", async () => {
    const fine = await review("Fine.", UNCHECKED);
    const rude = await review(RUDE, UNCHECKED, later(60_000));
    const reply = await postReviewReply(db, {
      reviewId: (await review("Lovely.", CLEAN)).id,
      role: "host",
      authorUserId: "host-1",
      body: "Thank you!",
      check: UNCHECKED,
      now: later(HOUR),
    });
    if (!reply.ok) throw new Error("reply failed");
    const seen: string[] = [];

    const summary = await runModerationSweep({
      db,
      now: later(2 * HOUR),
      check: async (text) => {
        seen.push(text);
        return answers({ "Fine.": CLEAN, [RUDE]: NAMED, "Thank you!": CLEAN })(text);
      },
    });

    // The text alone, oldest first.
    expect(seen).toEqual(["Fine.", RUDE, "Thank you!"]);
    expect(summary).toEqual({ rechecked: 3, published: 0, purged: { reports: 0, texts: 0 }, propertyIds: [ids.propertyId] });
    expect(await row("reviews", fine.id)).toMatchObject({ status: "published", check_source: "mistral" });
    expect(await row("reviews", rude.id)).toMatchObject({
      status: "pending",
      check_source: "mistral",
      flagged_reason: "personal_details",
      flagged_fragments: ["Jan Jansen"],
    });
    expect(await row("review_replies", reply.replyId)).toMatchObject({ status: "published", check_source: "mistral" });

    // Nothing left to recheck, nothing to refresh.
    expect(await runModerationSweep({ db, now: later(3 * HOUR), check: answers({}) })).toEqual({
      rechecked: 0,
      published: 0,
      purged: { reports: 0, texts: 0 },
      propertyIds: [],
    });
  });

  test("an item still unchecked at 72 hours publishes with its regex fragments masked", async () => {
    const mailed = await review(MAILED, REGEX_ONLY);
    const modelDown = answers({});

    expect(await runModerationSweep({ db, now: later(71 * HOUR), check: modelDown })).toMatchObject({
      rechecked: 0,
      published: 0,
      propertyIds: [],
    });
    expect(await row("reviews", mailed.id)).toMatchObject({ status: "pending", check_source: "unchecked" });

    expect(await runModerationSweep({ db, now: later(72 * HOUR), check: modelDown })).toMatchObject({
      rechecked: 0,
      published: 1,
      propertyIds: [ids.propertyId],
    });
    expect(await row("reviews", mailed.id)).toMatchObject({
      status: "published",
      published_by_deadline: true,
      masked_body: "Mail [removed] for the best tips.",
    });
  });

  test("a held item whose fragments aren't known yet waits for a recheck that finds them", async () => {
    // As 0061's backfill leaves an item 0038's regex held: a reason, no fragments.
    const legacy = await review(RUDE, UNCHECKED);
    await db.query(`UPDATE reviews SET flagged_reason = 'url', flagged_fragments = '[]' WHERE id = $1`, [legacy.id]);

    // Past its deadline, while the model is down: never published unmasked.
    expect(await publishOverdue(db, later(30 * 24 * HOUR))).toEqual({ published: 0, propertyIds: [] });
    expect(await runModerationSweep({ db, now: later(30 * 24 * HOUR), check: answers({}) })).toMatchObject({ published: 0 });
    expect(await row("reviews", legacy.id)).toMatchObject({ status: "pending", masked_body: null });

    // The recheck runs before the deadline, so the same run publishes it masked.
    expect(await runModerationSweep({ db, now: later(31 * 24 * HOUR), check: answers({ [RUDE]: NAMED }) })).toMatchObject({
      rechecked: 1,
      published: 1,
    });
    expect(await row("reviews", legacy.id)).toMatchObject({
      status: "published",
      masked_body: "[removed] at the desk was rude to us.",
    });
  });

  test("one failing recheck does not stop the rest", async () => {
    const first = await review("First.", UNCHECKED);
    const broken = await review("Broken.", UNCHECKED, later(60_000));
    const last = await review("Last.", UNCHECKED, later(120_000));
    const errors: unknown[][] = [];

    const summary = await runModerationSweep({
      db,
      now: later(HOUR),
      check: async (text) => {
        if (text === "Broken.") throw new Error("model exploded");
        return CLEAN;
      },
      onError: (error, context) => errors.push([(error as Error).message, context]),
    });

    expect(summary).toMatchObject({ rechecked: 2, published: 0 });
    expect(errors).toEqual([["model exploded", { kind: "review", id: broken.id }]]);
    expect(await row("reviews", first.id)).toMatchObject({ status: "published" });
    expect(await row("reviews", broken.id)).toMatchObject({ status: "pending", check_source: "unchecked" });
    expect(await row("reviews", last.id)).toMatchObject({ status: "published" });
  });
  test("a recheck of text that changed while it was checked is not stored", async () => {
    const held = await review("Fine.", UNCHECKED);
    const summary = await runModerationSweep({
      db,
      now: later(HOUR),
      // The guest's text changes while the model reads the old one.
      check: async () => {
        await db.query(`UPDATE reviews SET body = $2 WHERE id = $1`, [held.id, RUDE]);
        return CLEAN;
      },
    });
    expect(summary).toMatchObject({ rechecked: 0, propertyIds: [] });
    expect(await row("reviews", held.id)).toMatchObject({ status: "pending", check_source: "unchecked" });
  });
});
