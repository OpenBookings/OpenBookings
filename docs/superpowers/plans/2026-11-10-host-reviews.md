# Host Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Coming soon" page at `/dashboard/bookings/reviews` with the host Reviews page, where hosts read guest reviews and reply publicly (a short thread under the review) or privately (a message in the booking's Messages conversation).

**Architecture:** A new `review_replies` table holds the public thread; a private reply is an ordinary `messages` row with a new `review_id` link. The rules (whose turn it is, thread length) are pure functions in `@openbookings/pricing`; storage lives in `@openbookings/db/reviews`; the business app adds a scoped loader, server actions and a client view that mirrors `MessagesView`. The guest side shows published replies on the property page and lets the review's author answer on `/bookings/[id]/review`.

**Tech Stack:** Next.js (apps/business, apps/web), Postgres via `pg` (raw SQL, drizzle schema mirror), bun test, shadcn/ui, lucide-react.

**Spec:** Concept v2, https://claude.ai/artifact/TGKUVK8JiH6jvy4eRKwWSH (desktop and phone mockups, numbered decisions 1–7, decided questions). Executors read both.

**Branch / worktree:** `feat/host-reviews` in `../OpenBookings-host-reviews`, off `main` (d111cfa). One PR, one commit per task.

## Global Constraints

- Console mode only on business surfaces (DESIGN_SYSTEM.md §3.3): semantic tokens, no raw hex, no `bg-white/*`, `rounded-md`/`rounded-lg`, `shadow-xs` at most. Libre Franklin, no serif. Icons from `lucide-react`.
- Score words come from `reviewBand` / `REVIEW_BANDS` in `@openbookings/pricing`; the average from `displayedAverage` with `AVERAGE_WINDOW_MONTHS` (24) and `MIN_REVIEWS_FOR_AVERAGE` (3). Never stars.
- Reply text: 1 to `REPLY_BODY_MAX = 1000` characters after trimming (`normalizeReviewBody`).
- Public thread order: host, guest, host. `REPLY_THREAD_MAX = 3`. Only the host side and the review's own guest write in it.
- Every reply, both public and private, starts with the question "How do you want to reply to {firstName}?" and the choices **Publicly** ("Shows under the review on your property page") and **Privately** ("Sends a message to {firstName} in Messages"). Neither is preselected.
- Reviews can't be edited by anyone. Host replies can be edited (sets `edited_at`, shows "Edited") and deleted.
- Public host replies are signed "Response from {property name}". The team member's name never shows publicly.
- Every public reply runs through `screenReview` (links, phone numbers, emails). Flagged = stored as `pending`, never rejected. Private replies use `detectCircumvention` like any message.
- Hosts can't approve, hide or delete reviews.
- Who may reply: anyone with `{ booking: ["read"] }` at the review's property (`userCan`).
- Copy is plain and active. Reuse the exact copy in the mockups.
- No guest email about replies in this plan. It's its own concept later.

## Review Focus

1. **Two people reply at once** (host from two tabs, or host and guest together): exactly one wins the turn; the other gets "not_your_turn", never a fourth row or two host rows in a row. Pinned by a test in Task 2.
2. **Review deleted by its guest after a host reply:** the thread disappears from the property page with the review, hosts see "The guest deleted this review." and can't reply further. Pinned in Task 2 and Task 5.
3. **Team member without access to the property** (property-scoped role, no `property_access`): sees none of its reviews, and the actions return `not_found`. Pinned in Task 4.
4. **Org property with no `owner_user_id`** when replying privately: the private reply fails with a clear message instead of creating a thread with a null host. Pinned in Task 2.
5. **Host deletes an earlier reply after the guest answered:** refused (`not_last`), so a guest answer never hangs under nothing. Pinned in Task 2.

---

### Task 1: Migration, schema mirror and shared screening

**Files:**
- Create: `packages/db/drizzle/0039_review_replies.sql`
- Modify: `packages/db/src/schema.ts` (add `reviewReplies`, add `reviewId` to `messages`)
- Modify: `packages/db/src/testing/pending-migrations.ts` (add `"0039_review_replies.sql"`)
- Modify: `apps/business/app/(dashboard)/dashboard/listings/_lib/pending-migrations.ts` (add `"0038_guest_reviews.sql"`, `"0039_review_replies.sql"`)
- Move: `apps/web/lib/reviews/screen.ts` → `packages/messaging/src/screen-review.ts`, test alongside (`screen-review.test.ts`); export `screenReview` from `packages/messaging/src/index.ts`; update the import in `apps/web/lib/reviews/actions.ts`; delete the old files.

**Interfaces:**
- Produces: table `review_replies`, column `messages.review_id`, `screenReview(body: string | null): string | null` from `@openbookings/messaging`.

- [ ] **Step 1: Write `0039_review_replies.sql`** (idempotent, `SET lock_timeout = '5s'` like 0038):
  - `review_replies`: `id uuid PK default gen_random_uuid()`, `review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE`, `author_role text NOT NULL CHECK (author_role IN ('host','guest'))`, `author_user_id text NULL`, `body text NULL CHECK (char_length(body) <= 1000)`, `status text NOT NULL CHECK (status IN ('pending','published','hidden','deleted'))`, `flagged_reason text NULL`, `published_at`, `edited_at`, `deleted_at timestamptz NULL`, `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`, `CONSTRAINT review_replies_body_unless_deleted CHECK (status = 'deleted' OR body IS NOT NULL)`.
  - `CREATE INDEX IF NOT EXISTS idx_review_replies_review ON review_replies (review_id, created_at)`.
  - `ALTER TABLE messages ADD COLUMN IF NOT EXISTS review_id uuid NULL REFERENCES reviews(id) ON DELETE SET NULL`; `CREATE INDEX IF NOT EXISTS idx_messages_review ON messages (review_id) WHERE review_id IS NOT NULL`.
- [ ] **Step 2: Mirror it in `schema.ts`** with the same doc-comment style as `reviews` ("Mirrors packages/db/drizzle/0039_review_replies.sql; keep the two in sync.").
- [ ] **Step 3: Move `screenReview` and its test**, update the web import. Run `cd packages/messaging && bun test` and `cd apps/web && bun test lib/reviews`. Expected: PASS, no test left in apps/web/lib/reviews for screen.
- [ ] **Step 4: Apply locally to check the SQL parses twice:** `cd packages/db && bun test src/reviews` (the harness replays pending migrations). Expected: existing review tests PASS.
- [ ] **Step 5: Commit** `feat(db): review_replies table and messages.review_id`.

### Task 2: Reply rules and storage

**Files:**
- Modify: `packages/pricing/src/reviews.ts`, `packages/pricing/src/reviews.test.ts`
- Create: `packages/db/src/reviews/replies.ts`, `packages/db/src/reviews/replies.db.test.ts`
- Modify: `packages/db/src/reviews/index.ts` (`export * from "./replies"`; `PublicReview` gains `replies`; `GuestReview` gains `replies`)

**Interfaces:**
- Produces (pricing):
  - `REPLY_BODY_MAX = 1000`, `REPLY_THREAD_MAX = 3`
  - `type ReplyRole = "host" | "guest"`
  - `nextReplyRole(thread: readonly ReplyRole[]): ReplyRole | null` — `[]`→`"host"`, `["host"]`→`"guest"`, `["host","guest"]`→`"host"`, length ≥ 3 → `null`.
- Produces (db, `@openbookings/db/reviews`):
  - `type ReplyStatus = "pending" | "published" | "hidden" | "deleted"`
  - `type ReviewReply = { id: string; role: ReplyRole; body: string; status: ReplyStatus; publishedAt: string | null; editedAt: string | null; createdAt: string }` (ISO strings; deleted replies are never returned)
  - `type ReplyError = "not_found" | "invalid" | "not_your_turn" | "thread_closed" | "review_deleted" | "not_last" | "no_thread_host"`
  - `postReviewReply(db, i: { reviewId: string; role: ReplyRole; authorUserId: string; body: string; flaggedReason: string | null; now: Date }): Promise<{ ok: true; replyId: string; status: "published" | "pending"; propertyId: string } | { ok: false; error: ReplyError }>`
  - `editHostReply(db, i: { replyId: string; authorUserId: string; body: string; flaggedReason: string | null; now: Date }): Promise<{ ok: true; status: "published" | "pending"; propertyId: string } | { ok: false; error: ReplyError }>`
  - `deleteHostReply(db, i: { replyId: string; now: Date }): Promise<{ ok: true; propertyId: string } | { ok: false; error: ReplyError }>`
  - `insertPrivateReviewReply(db, i: { reviewId: string; senderUserId: string; body: string; flaggedReason: string | null; now: Date }): Promise<{ ok: true; threadId: string; guestUserId: string; message: MessageRow } | { ok: false; error: ReplyError }>` (`MessageRow` from `@openbookings/messaging/client` types or a local equivalent with the columns `RETURNING *` gives)
  - `loadReviewReplies(db, reviewIds: string[], opts: { publicOnly: boolean }): Promise<Map<string, ReviewReply[]>>`

Rules the code must enforce:
- `postReviewReply` locks the review (`SELECT ... FROM reviews WHERE id = $1 FOR UPDATE`), reads the non-deleted replies' roles in `created_at` order, and accepts only when `nextReplyRole(roles) === i.role`. `null` → `thread_closed`, a different role → `not_your_turn`. A review with status `deleted` (or `hidden`/`removed`) → `review_deleted`. Body via `normalizeReviewBody`; empty or over `REPLY_BODY_MAX` → `invalid`. Status `pending` if `flaggedReason` else `published` with `published_at = now`.
- Replies on a `pending` review are stored normally; they only appear publicly once the review is `published` (enforced by the public loader joining on review status).
- `editHostReply` only touches `author_role = 'host'` rows that aren't deleted; sets `body`, `flagged_reason`, `status`, `edited_at = now`, `updated_at = now`, `author_user_id` = the editor.
- `deleteHostReply` refuses unless the reply is the latest non-deleted reply of its review (`not_last`); sets `status = 'deleted'`, `body = NULL`, `flagged_reason = NULL`, `deleted_at = now`. The host may then reply again, because the deleted row no longer counts.
- `insertPrivateReviewReply`: find the review's booking; reuse `message_threads` where `booking_id` matches, else insert one with `host_id = properties.owner_user_id`, `guest_id = bookings.user_id`. If `owner_user_id` is null → `no_thread_host`. Insert into `messages (thread_id, sender_id, sender_role, body, flagged_reason, review_id)` with `sender_role = 'host'`, `flagged_reason = i.flaggedReason` (the caller runs `detectCircumvention`: `@openbookings/messaging` depends on `@openbookings/db`, so db must not import it), bump `message_threads.updated_at`. Body rules as for public replies (`invalid`).
- `loadPropertyReviews` attaches `replies` (published, non-deleted, `publicOnly: true`) to each `PublicReview`. `getReviewContext` attaches `replies` to `review`: published replies plus the guest's own pending ones.

- [ ] **Step 1: Write the failing pricing test** `nextReplyRole follows host, guest, host and then closes` with the four cases above.
- [ ] **Step 2: Run** `cd packages/pricing && bun test reviews` — FAIL (not exported).
- [ ] **Step 3: Implement** the constants, type and `nextReplyRole` in `packages/pricing/src/reviews.ts`.
- [ ] **Step 4: Run** again — PASS.
- [ ] **Step 5: Write the failing DB tests** in `replies.db.test.ts` (same harness and `seedProperty`/`seedBooking` setup as `reviews.db.test.ts`, with a submitted review):
  - `a host reply publishes and the guest may answer once` — post host → `{ok:true,status:"published"}`; post host again → `not_your_turn`; post guest → ok; post host → ok; post guest → `thread_closed`.
  - `a guest can't open the thread` — post guest first → `not_your_turn`.
  - `a flagged reply is held, not refused` — `flaggedReason: "url"` → `status: "pending"`; `loadPropertyReviews(...).reviews[0].replies` is `[]`.
  - `replies to a pending review show once it is published` — set review `status='pending'`, post host → ok; public replies `[]`; `UPDATE reviews SET status='published'`; public replies has 1.
  - `a second host reply in a row is refused` — two `postReviewReply` calls for `role:"host"` back to back → first `ok`, second `not_your_turn`, one host row. (Concurrent calls are serialized by the `FOR UPDATE` lock on the review row; the harness's single rolled-back transaction can't run two connections, so the lock is checked by reading the SQL in review, not by a test.)
  - `editing marks the reply edited and re-screens it` — edit with `flaggedReason: "phone_number"` → `status:"pending"`, `edited_at` set.
  - `only the latest reply can be deleted` — host, guest; delete host → `not_last`; delete... after a second host reply, delete it → ok and the host may post again.
  - `a deleted review closes the thread` — `deleteGuestReview` then post host → `review_deleted`; public replies gone.
  - `a private reply lands in the booking's conversation` — returns a thread whose `booking_id` is the booking and a message with `review_id`, `sender_role='host'`; a second private reply reuses the thread.
  - `a private reply needs a property owner to address the thread` — `UPDATE properties SET owner_user_id = NULL` → `no_thread_host`.
- [ ] **Step 6: Run** `cd packages/db && bun test src/reviews/replies` — FAIL (module missing).
- [ ] **Step 7: Implement** `replies.ts` and the `index.ts` changes.
- [ ] **Step 8: Run** `cd packages/db && bun test src/reviews` — all PASS (old suite too). `bun run typecheck` in packages/db and packages/pricing — clean.
- [ ] **Step 9: Commit** `feat(reviews): public reply threads and private replies`.

### Task 3: Business loader, shaping and sidebar count

**Files:**
- Create: `apps/business/lib/reviews/query.ts`, `apps/business/lib/reviews/query.db.test.ts`
- Create: `apps/business/lib/reviews/shape.ts`, `apps/business/lib/reviews/shape.test.ts`

**Interfaces:**
- Consumes: `loadReviewReplies`, `ReviewReply`, `nextReplyRole`, `displayedAverage`, `reviewBand`, `REVIEW_BANDS`, `AVERAGE_WINDOW_MONTHS`, `propertyReadAccessSql`, `getHostScopedDb`.
- Produces:
  - `type HostReview = { id: string; bookingId: string; propertyId: string; propertyName: string; score: number; body: string | null; authorName: string; authorCountry: string | null; stayMonth: string; roomLabel: string | null; status: "published" | "pending"; flaggedReason: string | null; postedAt: string; replies: ReviewReply[]; privateReplyAt: string | null; nextRole: ReplyRole | null }`
  - `loadHostReviews(session: SessionLike, host = getHostScopedDb(session), testing = isTestingMode()): Promise<HostReview[]>` — reviews with status `published` or `pending` at properties the viewer can read (`propertyReadAccessSql("$1", testing)`), newest first, at most 500; `privateReplyAt` = latest `messages.created_at` with that `review_id`; replies via `loadReviewReplies(..., { publicOnly: false })`.
  - `countReviewsNeedingReply(session: SessionLike): Promise<number>` — same scope, counts `needsReply`; returns 0 on any error (logs to Sentry with `area: "reviews"`).
  - In `shape.ts` (pure, no DB):
    - `needsReply(r: HostReview): boolean` — `status === "published"` and `nextRole === "host"` and not (`replies.length === 0` and `privateReplyAt !== null`).
    - `type ReviewTab = "reply" | "all" | "checking"`; `inTab(r, tab)`: reply → `needsReply`, all → `status === "published"`, checking → `status === "pending"`.
    - `filterHostReviews(list, { tab, propertyId: string | "all", band: ReviewBand | "all", sort: "newest" | "oldest" | "highest" | "lowest" })`
    - `summarize(list: HostReview[], propertyId: string | "all", now: Date): { average: number | null; band: string | null; recentCount: number; bands: { id; label; count }[]; waiting: number }` — average over published reviews from the last 24 months.

- [ ] **Step 1: Write failing `shape.test.ts`:** `needsReply` true for a fresh published review, false after a host reply, true after a guest answer, false after a private reply with no thread, false for pending; `summarize` gives `average: null` below 3 recent reviews and `8.7`/"Great" for scores `[9, 8, 9]`, ignores a 25-month-old review; `filterHostReviews` sorts lowest first and filters by band "okay" (5–6).
- [ ] **Step 2: Run** `cd apps/business && bun test lib/reviews/shape` — FAIL.
- [ ] **Step 3: Implement `shape.ts`.** Run — PASS.
- [ ] **Step 4: Write failing `query.db.test.ts`** (harness pattern of `lib/reservations/query.db.test.ts`): `the owner sees published and pending reviews of their property, with replies and private replies`; `a stranger sees nothing`; `a front-desk member without property_access sees nothing`; `deleted and hidden reviews are left out`; `countReviewsNeedingReply counts the open ones`.
- [ ] **Step 5: Run** `cd apps/business && bun test lib/reviews/query` — FAIL. **Implement `query.ts`.** Run — PASS.
- [ ] **Step 6: Commit** `feat(business): load a host's reviews`.

### Task 4: Business server actions

**Files:**
- Create: `apps/business/lib/reviews/actions.ts`, `apps/business/lib/reviews/actions.test.ts`

**Interfaces:**
- Consumes: Task 2 storage, `screenReview`, `deliverMessageToRecipient` (`@openbookings/messaging`), `userCan`, `purge` + `propertyReviewsKey` (`@openbookings/cache`), `getServerSession`.
- Produces (all `"use server"`, all return `type ReplyActionResult = { ok: true; status: "published" | "pending" | "sent" } | { ok: false; message: string }`):
  - `replyToReview(reviewId: string, input: { mode: "public" | "private"; body: string })`
  - `editReviewReply(replyId: string, body: string)`
  - `deleteReviewReply(replyId: string)`

Behaviour:
- Look up the review's (or reply's review's) `property_id`; `userCan(session, propertyId, { booking: ["read"] })`. Missing and forbidden both → `"We couldn't find this review."`.
- Public: `screenReview(body)` → `postReviewReply(... role: "host" ...)`; on success purge `propertyReviewsKey(propertyId)` so the reply shows on the property page now, then `revalidatePath("/dashboard/bookings/reviews")`.
- Private: `insertPrivateReviewReply` with `flaggedReason: detectCircumvention(body)`, then `deliverMessageToRecipient({ recipientId: guestUserId, threadId, message })`, revalidate reviews and messages paths. Returns `status: "sent"`.
- Rate limit with `checkRateLimit(\`review-reply:${userId}\`, 20, 10 * 60 * 1000)`.
- Error copy, exact:
  - invalid: "Write between 1 and 1,000 characters."
  - not_your_turn: "It's the guest's turn to answer. You can reply again after they do."
  - thread_closed: "This thread is closed. Carry on in Messages."
  - review_deleted: "The guest deleted this review."
  - not_last: "Only the latest reply can be deleted."
  - no_thread_host: "This property has no account to send messages from yet. Contact support."
  - rate limited: "You're going a bit fast. Wait a few minutes and try again."
- The permission/lookup part is a plain exported helper `reviewActor(session, reviewId, deps)` with injectable `userCan`/`queryOne`, so `actions.test.ts` can test it without a DB: `a member without booking read gets not_found`, `an unknown id gets not_found`, `the owner gets the property id`.

- [ ] **Step 1: Write failing `actions.test.ts`** for `reviewActor` (three cases above) and for the error-copy map (`messageFor("not_your_turn")` equals the exact string).
- [ ] **Step 2: Run** `cd apps/business && bun test lib/reviews/actions` — FAIL.
- [ ] **Step 3: Implement `actions.ts`.** Run — PASS. `bun run typecheck` in apps/business — clean.
- [ ] **Step 4: Commit** `feat(business): reply to reviews publicly or privately`.

### Task 5: Business Reviews page

**Files:**
- Modify: `apps/business/app/(dashboard)/dashboard/bookings/reviews/page.tsx`
- Create in `apps/business/components/dashboard/reviews/`: `reviews-view.tsx`, `reviews-summary.tsx`, `reviews-list.tsx`, `review-detail.tsx`, `reply-composer.tsx`
- Modify: `apps/business/components/dashboard/sidebar-08/nav-main.tsx` (sub item `badge?: number`), `app-sidebar.tsx` (prop `reviewsWaiting: number`), `apps/business/app/(dashboard)/layout.tsx` (load `countReviewsNeedingReply` alongside brand and support; null session → 0)

**Interfaces:**
- Consumes: `loadHostReviews`, `HostReview`, Task 3 `shape.ts`, Task 4 actions, `useOptionalSupport` (`components/support/support-provider.tsx`).

Build to the concept mockups, reusing what Messages ships:
- `ReviewsView` copies `MessagesView`'s structure: selection in `?id=`, list `lg:max-w-sm` left, detail right, `Sheet` (side right, full width) below 1024px. Tabs use `Tabs`/`TabsList` + `Badge` counts like `ReservationsTabs`: **To reply**, **All**, **Being checked** (phone label "Checking"). Filters: property `Select` (only when the list has more than one property), score words, sort (Newest first, Oldest first, Highest score, Lowest score).
- `ReviewsSummary`: one `Card` with the average (`text-3xl font-semibold tabular-nums`), band word and "{n} reviews · last 24 months", the five score-word bars in `bg-muted-foreground` on `bg-muted` (hidden below `sm`), and the sentence "**{n} reviews** are waiting for a reply." (singular "**1 review** is waiting for a reply."; none → "You're all caught up."). Below 3 recent reviews: "Your average shows from 3 reviews."
- `ReviewsList` rows: same markup as `MessagesList` `ThreadRow`, with the score chip in place of the avatar (`rounded-md border bg-muted/40 text-sm font-semibold tabular-nums`). Trailing: blue dot when `needsReply`, "Replied" / "Replied privately" text, or amber "Being checked" badge. "Score only" when there's no body.
- `ReviewDetail`: header (chip, "{Band} · {Name}, {CC}", "Stayed {Mon YYYY} · {room}", property name, `Button variant="outline"` "View reservation" → `/dashboard/bookings/reservations?id={bookingId}`), body (`whitespace-pre-line`), facts row ("Posted {relative}", "Verified stay", "Report" when support is available → `openIntake({ category: "bookings", linked: { type: "booking", id: bookingId, label: \`Booking #${bookingId.slice(0, 8)}\`, detail: \`Review by ${authorName}\` }, locked: true })`). Pending review: amber notice "Our automated check held this review for a person. It isn't public yet." Thread: host replies with "Response from {property}", "Edited" when `editedAt`, ghost Edit/Delete (Delete only on the last reply, Edit opens the composer prefilled); guest answers indented, "{Name} answered". Private reply note: "You replied privately in Messages {relative}." with "Open conversation" → `/dashboard/bookings/messages`. When `nextRole === null`: "This thread is closed. Carry on in Messages."
- `ReplyComposer`: state `mode: null | "public" | "private"`. `null` shows the ask card with the two choice buttons (Global Constraints copy). After a choice: line "**Public reply** · signed {property}" or "**Private message** · to {Name} in Messages", "Change" link, `Textarea` with a 0 / 1,000 counter, helper ("Up to 1,000 characters. You can edit it later." / "Goes to the conversation for this booking, with the review attached." / for a pending review, public: "Goes live together with the review."), primary button "Publish reply" / "Send message". Public is offered only when `nextRole === "host"`; when it isn't, the composer opens straight on private. On success: toast "Reply published", "Reply held for a check" or "Message sent"; errors in `role="alert"` under the box.
- Empty state (no reviews at all): `Star` icon, "No reviews yet", "We email your guests a day after they check out. Their reviews show up here, and you can reply to each one."
- Sidebar: Reviews sub item shows the count as a small `Badge` when > 0.

- [ ] **Step 1: Build the components and page.**
- [ ] **Step 2: Typecheck and lint:** `cd apps/business && bun run typecheck && bun run lint` — clean.
- [ ] **Step 3: Run it** (`business.localhost:3001`, see memory note on dev hosts) with a seeded review in demo/testing mode; check desktop and a 375px viewport: choose public → publish → reply shows with Edit/Delete; choose private → message appears in Messages with the guest; tabs and counts update; sidebar badge drops.
- [ ] **Step 4: Commit** `feat(business): reviews page`.

### Task 6: Guest side: replies on the property page and the guest's answer

**Files:**
- Modify: `apps/web/app/p/[hotel_slug]/_components/ReviewsCard.tsx` (detail pane shows the thread)
- Modify: `apps/web/app/bookings/[booking-ref]/review/page.tsx` (shows the thread; answer form)
- Create: `apps/web/app/review/_components/ReplyAnswerForm.tsx`
- Modify: `apps/web/lib/reviews/actions.ts` (add `answerHostReply`)

**Interfaces:**
- Consumes: `PublicReview.replies`, `GuestReview.replies`, `postReviewReply`, `nextReplyRole`, `screenReview`, `purgePropertyReviews`.
- Produces: `answerHostReply(bookingId: string, body: string): Promise<ReviewActionResult>` — signed-in guest who owns the booking only (same check as `deleteMyReview`); `postReviewReply(... role: "guest" ...)`; purge the property's reviews cache on publish; revalidate as `refresh()` does.

- Property page detail pane (Glass): under the review, each published reply as a quiet block: host → "Response from {property}" + date (+ "Edited"), guest → "{Name} answered" + date, `border-l border-white/15 pl-4`, text `text-white/75`. The overview card stays as it is.
- `/bookings/[id]/review`: below the guest's review, the same thread in the page's style; when `nextReplyRole(roles) === "guest"`, `ReplyAnswerForm` (textarea, 1,000 max, "Post answer"), helper "Shows under your review on the property page." Pending own answer: "Waiting for a person to check it."

The guest's turn rules are already tested in Task 2 (`a host reply publishes and the guest may answer once`, `a guest can't open the thread`); this task adds no new test.

- [ ] **Step 1: Build the UI and action.** `cd apps/web && bun run typecheck && bun run lint && bun test` — clean / PASS.
- [ ] **Step 2: Run it** (`web.localhost:3002`): the host reply from Task 5 shows on the property page; the guest answers from their booking; the business page shows it and offers the host's last reply.
- [ ] **Step 3: Commit** `feat(web): show review replies and let the guest answer`.

### Task 7: Docs and wrap-up

**Files:**
- Modify: `apps/docs/content/docs/business/reviews/index.mdx` (how replies work: public or private, the three-step thread, edits and deletes, the automated check, Report)
- Modify: `docs/privacy/data-map.md` (rows for `review_replies.body` and `messages.review_id`: free text, author role, retention follows the review; guest replies are anonymized with the review on account deletion — extend `anonymizeGuestReviews` to clear `author_user_id` on the guest's replies, with a test in `replies.db.test.ts`)

- [ ] **Step 1: Extend `anonymizeGuestReviews`** and its test (`a deleted account's answers lose their author link`). Run `cd packages/db && bun test src/reviews` — PASS.
- [ ] **Step 2: Update the two docs.**
- [ ] **Step 3: Full check:** `bun run typecheck && bun run lint && bun run test` at the repo root — clean / PASS.
- [ ] **Step 4: Commit** `docs: review replies`.
