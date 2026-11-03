# OpenBookings: personal data map

**Date:** 24 October 2026; revised 3 November 2026 (see "Revision notes")
**Scope:** this monorepo (`apps/web`, `apps/business`, `apps/support-bot`, `packages/*`, `scripts/`), plus what the code sends to outside systems. First written against `7e1eeb3`; revised against `75f6b2b`. The original pass was read-only; the revision changes only this file.
**Status:** a proposal for human and legal review. Every outcome below is a suggestion, not a decision.

**Sources of truth used.** `packages/db/src/schema.ts` is not complete. The Better Auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `team`, `teamMember`) and several app tables (`org_profile`, `org_consent`, `audit_log`, `property_access`, `passkey`, `twoFactor`) exist only in hand-applied SQL. Columns were taken from `packages/db/drizzle/0006`–`0025`, the schema snapshot in `apps/web/sql/ddl.sql` (stale in places: it types `bookings.user_id` as `uuid`), and the Better Auth config in `packages/auth/src`. `message_threads` and `messages` were created by migrations `0002`–`0004`, which are not in the repo (`packages/messaging/src/types.ts:1`). A live schema dump is needed to confirm nothing else exists (see U17).

An earlier audit, `docs/compliance/COMPLIANCE_AUDIT.md` (28 Sep 2026), was used as a list of leads only. Parts of it are out of date (for example, `consent_log` now exists and host support has been built). Everything here was re-checked against current code, except where a row says "per prior audit".

### Revision notes (3 November 2026)

This map was written at `7e1eeb3`. Since then the code changed in ways that touch personal data, and this revision brings the map up to date with them. It was **not** a fresh audit.

- **Added between the audit and the revision:** guest account deletion and "download my data" (`apps/web/lib/account/`), the `guest_profile` and `guest_room_likes` tables (`0028`, `0029`), the `refunds` table and the booking lifecycle code that writes it (`0027`). The PostHog erasure script and the onboarding backfill script were deleted in #143.
- **Changed by the security remediation:** Microsoft sign-in was removed; `saveStepData` accepts two steps only; uploads are bound to the host and checked in the bucket; `properties.owner_user_id` no longer grants access and follows the current owner; message threads follow it; a deleted guest's messages are redacted; Connect accounts are stamped with the creating user's id; support attributes and escalation notes are validated; the support bot lists bookings by email only for emails Chatwoot verified.
- **Citations.** Every `file:line` was remapped through `git diff 7e1eeb3..HEAD` and kept only where the cited line's text is identical at the new position. About a dozen citations pointed past the end of their file even at the time (probably numbered against the local DDL dump) and were corrected where the target could be found. `ddl.sql` citations refer to `apps/web/sql/ddl.sql`, a gitignored local dump that is not in the repo, and could **not** be re-checked.
- **Counts** in Section 1 were recomputed from the table. Anything about live data, vendors or settings (the UNCLEAR items) was not re-checked.

---

## 1. Summary

### How to read the outcomes

The questions were applied in order; the first "yes" wins.

1. **Open matter** (upcoming stay, dispute, chargeback, unpaid payout): `hold`. This applies to a **person**, not a column. If a guest has an upcoming stay or open dispute, or a host has upcoming bookings, pending payouts or an open dispute, everything linked to that matter is held. Rows marked `hold → X` are the ones an open matter typically needs; `X` is the outcome once it closes.
2. **Legal retention duty** (Dutch fiscal ~7 years, DAC7 ~10 years): `retain-restricted`, meaning kept, access-limited, and deleted when the period ends.
3. **Identifies on its own**: `delete`. Linkable IDs (IP, user agent, provider IDs, credentials) are treated as identifying on their own, because they single a person out. Non-identifying attributes in a row that is deleted as a whole are marked `delete` and go with the row.
4. **Free text or special category**: `delete`.
5. **Identifies in combination**: `coarsen`.
6. **Otherwise**: `keep`.

`n/a` means we cannot act on it ourselves: the data sits on the person's own device, or with a vendor that is controller in its own right (Stripe KYC, OAuth identity providers). `UNCLEAR` means the code doesn't say; Section 5 lists what would settle each one.

**Subjects:** `guest`, `host` (the business owner; for a B&B or sole trader, a natural person), `staff` (other members of a host organisation, and OpenBookings platform staff where noted), `third party` (people who are neither, e.g. invitees, people in photos), `none`.

### Counts (main table, 187 rows)

A row is one field or a group of closely related fields, so these are counts of rows, not of database columns.

| Kind | Rows |
|---|---|
| Direct identifier | 47 |
| Quasi-identifier | 28 |
| Linkable ID | 68 |
| Special category (Art. 9) | 0 dedicated fields; 4 free-text rows carry Art. 9 risk (`bookings.guest_notes`, `messages.body`, `support_context_cache.turns`, Chatwoot messages) |
| Free text | 21 |
| Non-personal | 14 |
| UNCLEAR | 9 |

| Proposed outcome (final, after any hold) | Rows |
|---|---|
| `delete` | 113 |
| `retain-restricted` | 32 |
| `coarsen` | 1 |
| `keep` | 9 |
| `n/a` | 22 |
| `UNCLEAR` | 10 |
| Rows marked `hold →` first | 36 |

**UNCLEAR items: 26** (U1–U26 in Section 5). 12 table rows are UNCLEAR in Kind or Outcome; the other items are open questions that don't map to a single row.

### Most important findings

1. **PostHog receives raw email addresses, without consent.** Both magic-link routes send a server-side event with `distinctId = email` and `properties.email = email` (`apps/web/app/api/auth/login-link/route.ts:85-95`, `apps/business/app/api/auth/login-link/route.ts:99-109`). This runs for every magic-link request, signed up or not, and bypasses the cookie banner (the banner only gates the browser SDK). It contradicts the promise in `packages/analytics/src/client.tsx:342-346` that PostHog "never receives a name, email, or full IP". There is no PostHog erasure tooling in the repo any more (`scripts/delete-posthog-person.ts` was removed in #143), so neither these email-keyed persons nor the UUID-keyed ones can be deleted by us except by hand in the PostHog dashboard.

2. **Guests can now delete their account and download their data; hosts cannot, and a delete still leaves references behind.** `apps/web/lib/account/deletion.ts:20-46` refuses while a paid stay is still to come, then unlinks the guest's consent events (`consent_log.user_id` set to NULL), unlinks **and redacts** their messages (`sender_id` NULL, `body` replaced), closes their threads, and lets the `user` delete cascade to `session`, `account`, `passkey`, `guest_profile` and `guest_room_likes`. `apps/web/lib/account/export.ts:9` builds the Art. 15/20 download. Nothing equivalent exists for hosts: the host auth instance has no `deleteUser`. Many tables still refer to a user by a **text id with no foreign key**, and a delete leaves those rows pointing at a raw id: `bookings.user_id` (kept on purpose for the fiscal records, A1), `refunds.created_by`, `message_threads.host_id/guest_id`, `audit_log.actor_user_id/target_user_id`, `rate_overrides.created_by`, `rate_plan_restrictions.created_by`, `room_closures.created_by`, `room_inventory.updated_by` and `properties.owner_user_id`. A host user delete would cascade only to `session`, `account`, `member`, `passkey`, `twoFactor`, `host_onboarding`, `support_contacts` and `support_ticket_reads`. The id also lives in PostHog, Tirreno, Chatwoot (contact identifier), Stripe metadata (checkout sessions and, since this revision, connected accounts) and QStash payloads, and the guest delete reaches none of those.

3. **Retention jobs exist but nothing runs them, and several stores have no purge at all.** `messaging-retention` (365 days; it now also sweeps messages whose sender was already unlinked) and `pii-retention` (18 months) are HTTP routes that expect a Cloud Scheduler job. No scheduler is defined in `.github/workflows` or anywhere else in the repo. Nothing ever deletes from `support_context_cache` (verbatim chat transcripts; the 6-hour TTL is only applied on read), `audit_log` (IP and user agent on every host sign-in), `processed_events`, or expired `verification` rows (which hold an email).

4. **Guest PII is collected into the host's Stripe account, where we can't delete it.** Bookings are direct charges on the host's connected account. Checkout prefills the guest's email and turns on phone and billing-address collection (`packages/stripe/src/payments/checkout.ts:50-63`). That data, plus `metadata.userId`, lives on the host's Stripe account and in the host's full Stripe Dashboard. A deletion request has to be routed to the host and Stripe; who is controller for it needs to be settled in the Partner Agreement and DPA (L1).

5. **Host personal data is published, cached and never cleaned up.** Onboarding copies the host's login email into the public `property_content.contact_email` (`apps/business/app/(onboarding)/onboarding/promotion.ts:189`). The public listing shows the address, exact coordinates, contact email and phone, legal name, KvK and VAT number (`apps/web/lib/hotel-page-query.ts:100-117`), and caches all of it in Upstash Redis for up to a day. For a B&B that is the owner's home address and, for older Dutch sole-trader VAT numbers, a number that embedded the BSN. Uploaded photos go to R2 as original files with no EXIF stripping, are public through `cdn.openbookings.co`, and are **never deleted**: deleting an image only removes the database row (`apps/business/app/api/property-images/[id]/route.ts:66-68`).

6. **Support conversations are copied into at least seven places.** Chatwoot (system of record), `support_context_cache` (indefinitely), Upstash QStash task payloads (message text plus guest email), Mistral (up to 20 verbatim turns plus booking tool results), `support_tickets.title` and `last_message_preview` (free text), Chatwoot private escalation notes (tool arguments and results, including the guest's full name in host tickets, `apps/support-bot/src/escalation-note.ts:47`; the reason and tool text are now sanitised before posting, the content is not reduced), and app logs in dev. Host tickets also attach a PostHog session-replay URL to the Chatwoot conversation (`apps/business/components/support/support-provider.tsx:392`), which links the two vendors (only https `posthog.com` links are accepted now). Hosts can attach up to five images or PDFs per message, so guest ID scans or booking screenshots can end up in Chatwoot.

7. **OAuth tokens are stored in plaintext, indefinitely, and Microsoft's are still there.** `account.accessToken`, `refreshToken` and `idToken` are kept for Google and Apple sign-ins, and `encryptOAuthTokens` isn't set anywhere. The app never uses them after sign-in. Microsoft sign-in was removed on 3 November 2026, but **its existing `account` rows were not**: they still hold the same plaintext tokens, the Entra `tid` in `account.tenant_id`, and the Microsoft `oid` in `accountId`. The code that wrote them is gone and nothing deletes them (Section 4). The `idToken` carries email, name and subject id; migration `0024` decodes it to rewrite Microsoft ids, which shows the claims are there.

8. **`host_onboarding.step_data` keeps everything, and until this revision the browser could write any key into it.** `saveStepData` now accepts only `core-info-text` and `core-info-location`, parsed to their known fields (`apps/business/app/(onboarding)/onboarding/_lib/step-data.ts:36`). Before, it merged whatever step name and data the client sent, including `stripe_account_id` (copied onto the property as its payout account) and the signed legal records, so **rows written before then may hold stray or forged keys** (U5). The blob holds the signer's full name, role, VAT/KvK and signature IPs, and `resetLegalData` appends every earlier attempt to `previousAttempts[]` for good (`actions.ts:186-212`). All of it is duplicated into `org_profile`, `org_consent` and `properties` once onboarding completes, but the original is never cleared.

9. **Full URLs go to PostHog and Sentry.** The manual `$pageview` sends `window.location.href` (`packages/analytics/src/client.tsx:274`). That includes `/bookings/<booking-ref>`, `/checkout/confirmation/<booking-ref>`, `/checkout/return?session_id=cs_…` and search query strings with dates and party size. Sentry runs with no `beforeSend` in any of the six configs and `tracesSampleRate: 1`, and some calls add the booking id and Stripe Checkout Session id as `extra` (`apps/web/app/api/checkout/route.ts:301`, `apps/web/app/checkout/return/page.tsx:139`).

10. **Host staff sign-ins are shared beyond the signer.** Every host sign-in writes IP and user agent to `audit_log` and sends `userId` + IP + user agent to Tirreno (`apps/business/lib/tirreno.ts:18-31`), which has no deletion call. A sign-in from a new device emails the signer's IP, city and device to **every owner of the organisation** (`apps/business/lib/mailing/security-alert.ts:78-87,114`), which amounts to an employer seeing an employee's location.

**What is in good shape.** No guest passport, ID-document or date-of-birth fields exist. Card data never touches our servers (Stripe `ui_mode: 'form'`). There are no pgvector embeddings, and DocuSeal and Gotenberg are not used in code. `consent_log` deliberately stores no IP or user agent. The support bot never puts the guest's email in a prompt; identity stays in server-side tool context, and it will not list bookings for an email Chatwoot has not verified (`CHATWOOT_VERIFIED_INBOX_IDS`, `apps/support-bot/src/chatwoot/identity.ts:24`) (`apps/support-bot/src/agent/tools.ts:25-37`). Nothing writes `bookings.guest_notes` yet, so the most likely Art. 9 field is still empty. Booking checkout is pinned to a seeded booking (`apps/web/app/checkout/_lib/booking.ts:31`), and the host reservations and analytics screens run on mock or demo data, so real guest booking volume is currently near zero.

### Systems of record

- **Messaging:** Postgres `messages` / `message_threads` is the system of record. The Cloudflare Durable Object worker (`ob-durableobjects`) is a delivery relay: it receives the full message row over HTTP and pushes it over WebSocket (`packages/messaging/src/realtime.ts:38-58`). Per the prior audit it stores only `pending:<messageId>` → `{messageId, threadId, recipientId, deadline}` for 5 minutes. Its source is not in this repo, so that was **not re-verified** (U1). Only `apps/business` mounts the thread routes; `apps/web` has no messaging routes yet.
- **Host support:** Chatwoot is the system of record for messages and attachments. Postgres holds ticket metadata, previews and a transcript cache.
- **Payments:** Stripe (on the host's connected account) is the system of record. Nothing creates `bookings`, `reservations` or `transactions` rows yet (only the seed does). The booking lifecycle (`packages/db/src/booking-lifecycle/index.ts`) updates bookings and reservations and writes `refunds`.
- **Object storage:** R2 holds property and room images only. Keys are `uploads/<owner tag>/<uuid>.{jpg,png,webp}`, where the owner tag is 16 hex characters of a SHA-256 of the host's user id (not reversible, but the same for all of one host's uploads). Uploads use presigned PUT URLs that expire after 10 minutes and sign the byte size (at most 10 MB); `/api/upload/confirm` checks the key is the caller's and that the object exists with an allowed type and size (`apps/business/lib/upload-policy.ts:43,61`); reads are **public, unsigned**, via `MEDIA_BASE_URL` (`apps/business/lib/s3.ts:61-67`, `apps/business/app/api/upload/presign/route.ts:41-61`).

---

## 2. Main table

`hold →` = held first if the person has an open matter (see Section 1). DUP = the same data is also held elsewhere (listed).

### 2.1 Postgres (Neon): auth tables (Better Auth)

| System | Table/location | Field | Subject | Kind | Proposed outcome | Notes | Source |
|---|---|---|---|---|---|---|---|
| Postgres | `user` | `id` | guest / host / staff | Linkable | delete | Text PK. Referenced **without FK** by bookings, threads, messages, audit_log, consent_log, refunds and rate/closure authorship columns (finding 2). Also used as PostHog distinct_id, Tirreno `userName`, Chatwoot contact `identifier`, Stripe `metadata.userId`, realtime token. | `apps/web/sql/ddl.sql:232`; `packages/auth/src/shared.ts:360` |
| Postgres | `user` | `name` | guest / host / staff | Direct | delete | From OAuth profile or entered at sign-up. Shown to hosts as guest name (initial + surname in thread list), sent to Mistral and Chatwoot notes in host tickets, Chatwoot contact name. DUP: `org_consent.signer_full_name`, `host_onboarding…fullName`, Chatwoot. | `ddl.sql:235`; `apps/support-bot/src/host/queries.ts:59` |
| Postgres | `user` | `email` | guest / host / staff | Direct | delete | Unique; one email = one account. DUP: `verification.value`, Stripe `customer_email` (guest) and connected-account `email` (host), Chatwoot contact, PostHog distinct_id (finding 1), QStash payloads, `property_content.contact_email`, Lettermint, passkey account name on devices. | `ddl.sql:236`; `packages/auth/src/shared.ts:335-341` |
| Postgres | `user` | `image` | guest / host / staff | Direct | delete | OAuth avatar URL, usually a face photo. Shown to hosts in the message list (`guest_image`). | `ddl.sql:238`; `apps/business/app/(dashboard)/dashboard/bookings/messages/page.tsx:24` |
| Postgres | `user` | `emailVerified`, `account_type`, `twoFactorEnabled`, `role` | guest / host / staff | Non-personal | delete | Row-level attributes. `role` is the platform-staff admin role. | `ddl.sql:237,240`; `drizzle/0011_org_iam.sql:9`; `drizzle/0012_passkeys_stepup.sql:39` |
| Postgres | `user` | `createdAt`, `updatedAt` | guest / host / staff | Quasi | delete | Row-level. | `ddl.sql:239` |
| Postgres | `user` | `banned`, `banExpires` | guest / host | Quasi | hold → delete | A ban can be an open fraud matter; ask lawyer whether ban data may outlive erasure to stop re-registration (L8). | `drizzle/0011_org_iam.sql:10-12` |
| Postgres | `user` | `banReason` | guest / host | Free text | hold → delete | Staff-written free text. | `drizzle/0011_org_iam.sql:11` |
| Postgres | `session` | `token` | guest / host / staff | Linkable | delete | Session credential. Cascades on user delete. Host sessions expire after 24 h; guest default. | `ddl.sql:459`; `packages/auth/src/host.ts:235` |
| Postgres | `session` | `ipAddress` | guest / host / staff | Linkable | delete | Resolved from `cf-connecting-ip`. Stored for guests too. | `ddl.sql:462`; `packages/auth/src/shared.ts:146-149` |
| Postgres | `session` | `userAgent` | guest / host / staff | Linkable | delete | | `ddl.sql:463` |
| Postgres | `session` | `userId`, `activeOrganizationId`, `portal`, `expiresAt`, `createdAt`, `updatedAt` | guest / host / staff | Linkable | delete | Row-level. | `ddl.sql:456-470`; `drizzle/0009_auth_boundary.sql:14` |
| Postgres | `session` | `impersonatedBy` | staff (platform) | Linkable | delete | Platform staff user id during impersonation. | `drizzle/0011_org_iam.sql:13` |
| Postgres | `session` | `lastVerifiedAt`, `lastFactorVerifiedAt` | host / staff | Quasi | delete | Step-up clocks. | `drizzle/0012_passkeys_stepup.sql:44`; `drizzle/0019_factor_stepup.sql:17` |
| Postgres | `account` | `accountId` | guest / host / staff | Linkable | delete | Provider subject: Google `sub`, Apple `sub`, and on legacy rows Microsoft `oid`. | `ddl.sql:272`; `drizzle/0024_better_auth_1_7.sql:18-81` |
| Postgres | `account` | `accessToken`, `refreshToken` | guest / host / staff | Linkable | delete | **Plaintext** OAuth credentials; app code never uses them after sign-in. Should not be kept (Section 4). | `ddl.sql:275-276` |
| Postgres | `account` | `idToken` | guest / host / staff | Direct | delete | JWT with email, name, sub, and on legacy Microsoft rows the `oid` and Entra `tid`. Plaintext, kept indefinitely. | `ddl.sql:277`; `drizzle/0024_better_auth_1_7.sql:54-77` |
| Postgres | `account` | `password` | guest / host / staff | UNCLEAR | delete | No email/password provider is configured, so this should be NULL everywhere (U7). | `ddl.sql:281`; `packages/auth/src/guest.ts:59-140` |
| Postgres | `account` | `tenant_id` | host / staff | Quasi | delete | Microsoft Entra tenant: identifies the employer. **Unused since Microsoft sign-in was removed**; existing values remain. Delete the Microsoft `account` rows and drop the column (Section 4). | `drizzle/0010_microsoft_tenant.sql:12` |
| Postgres | `account` | `providerId`, `scope`, token expiry timestamps | guest / host / staff | Non-personal | delete | Row-level. | `ddl.sql:273-280` |
| Postgres | `verification` | `identifier` | guest / host / staff | Linkable | delete | Magic-link token (credential). | `node_modules/.bun/better-auth@1.7.12…/dist/plugins/magic-link/index.mjs:91-92` |
| Postgres | `verification` | `value` | guest / host / staff | Direct | delete | JSON `{type:"magic-link", email, name}`. Written for every magic-link request, including people who never finish sign-up. Expires after 15 min, but whether expired rows are purged is U6. | `…/magic-link/index.mjs:93-97`; `packages/auth/src/shared.ts:514` |
| Postgres | `verification` | `expiresAt`, `createdAt`, `updatedAt` | guest / host / staff | Quasi | delete | Row-level. | `ddl.sql:252-262` |
| Postgres | `passkey` | `name` | host / staff | Free text | delete | Host-chosen label ("Anna's iPhone"). | `drizzle/0012_passkeys_stepup.sql:10`; `packages/auth/src/passkey-account-name.ts:10-13` |
| Postgres | `passkey` | `publicKey`, `credentialID`, `userId` | host / staff | Linkable | delete | Cascades on user delete. | `drizzle/0012_passkeys_stepup.sql:11-14` |
| Postgres | `passkey` | `aaguid`, `deviceType`, `backedUp`, `transports`, `counter`, `createdAt` | host / staff | Quasi | delete | `aaguid` identifies the authenticator model. | `drizzle/0012_passkeys_stepup.sql:15-21` |
| Postgres | `twoFactor` | `secret`, `backupCodes` | host / staff | Linkable | delete | Encrypted by the plugin. Cascades on user delete. | `drizzle/0012_passkeys_stepup.sql:29-31` |
| Postgres | `twoFactor` | `verified`, `failedVerificationCount`, `lockedUntil` | host / staff | Non-personal | delete | Row-level. | `drizzle/0012_passkeys_stepup.sql:33-34`; `drizzle/0024_better_auth_1_7.sql:16` |
| Postgres | `organization` | `name` | host | Direct | hold → retain-restricted | Legal company name. For an eenmanszaak or B&B this is often the owner's name. DAC7 seller name (10 y). DUP: `org_profile.legal_entity_name`, `property_content.legal_company_name`, `host_onboarding…legalCompanyName`, Stripe `business_profile.name`, payout-alert email subject. | `ddl.sql:166`; `apps/business/lib/provision-organization.ts:85-104` |
| Postgres | `organization` | `slug` | host | Quasi | delete | Derived from the legal name (`slugifyOrgName`), or the name plus `md5(user_id)` for backfilled orgs. Replace with an opaque value. | `apps/business/lib/provision-organization.ts:32-42`; `drizzle/0013_org_backfill.sql:36-40` |
| Postgres | `organization` | `logo`, `metadata` | host | UNCLEAR | UNCLEAR | No writer in the repo (U2). | `ddl.sql:168,170` |
| Postgres | `member` | `userId`, `role`, `organizationId`, `createdAt` | host / staff | Linkable | delete | Cascades on user delete. Ownership history is not otherwise recorded except in `audit_log`. | `ddl.sql:373-384` |
| Postgres | `invitation` | `email` | third party (invitee) | Direct | delete | Invite endpoint is mounted by the organization plugin; no invite UI in the repo. | `ddl.sql:349-362` |
| Postgres | `invitation` | `inviterId`, `role`, `status`, `expiresAt`, `teamId` | host / staff | Linkable | delete | | `ddl.sql:349-362` |
| Postgres | `team`, `teamMember` | `name`, `userId` | staff | UNCLEAR | UNCLEAR | In the DDL snapshot; teams aren't enabled in the org plugin config. Do the tables exist and hold rows? (U3) | `ddl.sql:479-505`; `packages/auth/src/host.ts:310-347` |
| Postgres | `guest_profile` | `phone` | guest | Direct | delete | Entered on Personal details. `ON DELETE CASCADE` from `user`; included in the data export. | `drizzle/0028_guest_profile.sql:12-21`; `packages/db/src/schema.ts:955`; `apps/web/app/account/personal-details/_lib/actions.ts:27` |
| Postgres | `guest_profile` | `address_line1`, `address_line2`, `postal_code`, `city`, `country` | guest | Direct | delete | Home address. Same cascade and export. | `drizzle/0028_guest_profile.sql:12-21`; `packages/db/src/schema.ts:955` |
| Postgres | `guest_profile` | `updated_at` | guest | Non-personal | delete | Row-level. | `drizzle/0028_guest_profile.sql:12-21` |
| Postgres | `guest_room_likes` | `user_id`, `room_id`, `created_at` | guest | Linkable | delete | Which rooms a guest liked. Cascades from both `user` and `rooms`; included in the export. | `drizzle/0029_guest_room_likes.sql:12-17`; `packages/db/src/schema.ts:973` |

### 2.2 Postgres: host organisation, onboarding, audit

| System | Table/location | Field | Subject | Kind | Proposed outcome | Notes | Source |
|---|---|---|---|---|---|---|---|
| Postgres | `org_profile` | `legal_entity_name` | host | Direct | hold → retain-restricted | DAC7 (10 y) and commission-invoice counterparty (7 y). Direct for sole traders. DUP (see `organization.name`). | `drizzle/0011_org_iam.sql:31` |
| Postgres | `org_profile` | `kvk_number` | host | Direct | hold → retain-restricted | Dutch KvK only (no BE/other equivalent). For an eenmanszaak the public register names the person. Optional at onboarding. | `drizzle/0011_org_iam.sql:32` |
| Postgres | `org_profile` | `vat_number` | host | Direct | hold → retain-restricted | Not format-validated. Pre-2020 Dutch sole-trader VAT numbers embedded the **BSN** (U26). DUP: `property_content.vat_number` (public), `host_onboarding`. | `drizzle/0011_org_iam.sql:33` |
| Postgres | `org_profile` | `stripe_account_id` | host | Linkable | hold → retain-restricted | Proxy for the DAC7 financial-account identifier. DUP: `properties`, `host_onboarding.step_data`, `audit_log.detail`. | `drizzle/0011_org_iam.sql:34` |
| Postgres | `org_profile` | `auth_policy`, `onboarding_completed_at`, `created_at`, `updated_at` | host | Non-personal | keep | Organisation settings. | `drizzle/0011_org_iam.sql:37-39`; `drizzle/0020_org_onboarding_completed.sql:26` |
| Postgres | `org_consent` | `signer_full_name` | host / staff | Direct | retain-restricted | Evidence of signed Partner Agreement, DPA and rates-tax confirmation. A legal-claims ground, not fiscal; period is L2. | `drizzle/0011_org_iam.sql:44-54`; `apps/business/lib/provision-organization.ts:129-151` |
| Postgres | `org_consent` | `signed_by_user_id` | host / staff | Linkable | retain-restricted | Same as above. Also written from the ARI grid confirmation. | `apps/business/app/(dashboard)/dashboard/listings/rates-availability/_lib/actions.ts:449-457` |
| Postgres | `org_consent` | `signer_ip` | host / staff | Linkable | retain-restricted | Taken from the first `x-forwarded-for` hop, which a client can spoof; weak evidence. | `apps/business/app/(onboarding)/onboarding/actions.ts:142-145` |
| Postgres | `org_consent` | `signer_role_title`, `signed_at`, `doc_id` | host / staff | Quasi | retain-restricted | | `drizzle/0011_org_iam.sql:51-52` |
| Postgres | `property_access` | `member_id`, `property_id` | staff | Linkable | delete | Cascades from `member`. | `drizzle/0011_org_iam.sql:20-25` |
| Postgres | `audit_log` | `actor_user_id`, `target_user_id` | host / staff / staff (platform) | Linkable | retain-restricted | Security log; never purged. Kept for payment/commission/dispute entries (fiscal); for `auth.*` entries, delete after a security retention period (L5). | `drizzle/0011_org_iam.sql:67-78`; `packages/auth/src/host.ts:182-191` |
| Postgres | `audit_log` | `ip` | host / staff | Linkable | delete | Written on **every host sign-in** and on rates confirmation. No purge. | `packages/auth/src/host.ts:182-191`; `rates-availability/_lib/actions.ts:461` |
| Postgres | `audit_log` | `user_agent` | host / staff | Linkable | delete | Used for new-device detection; that detection needs only a hash. | `packages/auth/src/host.ts:174-180` |
| Postgres | `audit_log` | `reason` | staff (platform) / host | Free text | delete | Impersonation reason. `impersonateWithAudit` has no call site in the repo; the stock `/admin/impersonate-user` route is now disabled over HTTP, so this wrapper is the only way in. | `packages/auth/src/host.ts:428-466` |
| Postgres | `audit_log` | `detail` (JSONB) | host | Quasi | retain-restricted | Shapes found: `auth.sign-in` `{newDevice}`; `org.provisioned` `{slug, stripeAccountId}`; `payout.onboarding-link-created` `{stage}`; `payout.external-account-changed` `{stripeAccountId, change, last4, country, dedupeKey}`; `payment.dispute-opened` `{disputeId, chargeId, amount, reason, stripeAccountId, dedupeKey}`; `commission.refunded` `{chargeId, feeRefundId, amount, …}`; `rates.inclusive-confirmed` `{docId}`. Retain the money entries; delete the auth ones with their row. | `apps/business/app/api/stripe/webhook/route.ts:33-43,69-78`; `apps/business/lib/stripe-events.ts:132-175`; `apps/business/app/api/stripe/account-link/route.ts:83-86` |
| Postgres | `audit_log` | `organization_id`, `action`, `created_at` | host | Linkable | retain-restricted | | `drizzle/0011_org_iam.sql:67-78` |
| Postgres | `host_onboarding` | `user_id` | host | Linkable | delete | Cascades on user delete. | `drizzle/0007_host_onboarding.sql:19-21` |
| Postgres | `host_onboarding` | `step_data.core-info-text.{displayName, tagline, description, houseRulesText}` | host | Free text | delete | Copied into `properties` / `property_content` at completion; the original is never cleared. | `apps/business/app/(onboarding)/onboarding/actions.ts:49-54` |
| Postgres | `host_onboarding` | `step_data.core-info-location.{streetAddress, city, postalCode, country}` | host | Direct | delete | B&B home address. The retained copy is `properties.address_*`. | `actions.ts:56-62` |
| Postgres | `host_onboarding` | `step_data.core-info-location.coordinates` | host | Direct | delete | Exact point. | `actions.ts:61` |
| Postgres | `host_onboarding` | `step_data.legal-n-boring.{legalCompanyName, vatNumber, cocNumber}` | host | Direct | delete | Duplicate of `org_profile` (retained there). | `actions.ts:32-38` |
| Postgres | `host_onboarding` | `step_data.legal-n-boring.{fullName, roleTitle}` | host / staff | Direct | delete | Duplicate of `org_consent` (retained there). | `actions.ts:34-35` |
| Postgres | `host_onboarding` | `step_data.legal-n-boring.{partnerAgreement, dpa, ratesInclusive}.{signedAt, signerIp, downloadedAt, downloadedFilename}` | host / staff | Linkable | delete | Duplicate of `org_consent`. | `actions.ts:14-19,134-183` |
| Postgres | `host_onboarding` | `step_data.legal-n-boring.previousAttempts[]` | host / staff | Direct | delete | Every reset keeps the old name, role, VAT, KvK and signature IPs indefinitely. Should not be collected. | `actions.ts:186-212` |
| Postgres | `host_onboarding` | `step_data.stripe_account_id` | host | Linkable | delete | Duplicate of `org_profile.stripe_account_id`. | `actions.ts:243-249` |
| Postgres | `host_onboarding` | `step_data` (any other keys) | host | UNCLEAR | UNCLEAR | `saveStepData` now accepts two steps only (`_lib/step-data.ts:36`); before, it merged unvalidated client input, so existing rows may hold other keys, including forged `stripe_account_id` or legal records (U5). | `apps/business/app/(onboarding)/onboarding/actions.ts:109`; `_lib/step-data.ts:36` |
| Postgres | `host_onboarding` | `completed_steps`, `onboarding_completed_at` | host | Non-personal | delete | Row-level. | `drizzle/0007_host_onboarding.sql:24-30` |

### 2.3 Postgres: listings (host-authored)

| System | Table/location | Field | Subject | Kind | Proposed outcome | Notes | Source |
|---|---|---|---|---|---|---|---|
| Postgres | `properties` | `name` | host | Quasi | hold → retain-restricted | B&B names often carry the owner's name. Needed to identify the listing in retained booking and DAC7 records. | `packages/db/src/schema.ts:96` |
| Postgres | `properties` | `slug` | host | Quasi | delete | Public URL derived from the name; replace with an opaque value. | `schema.ts:97` |
| Postgres | `properties` | `address_line_1`, `address_line_2`, `postal_code`, `city` | host | Direct | hold → retain-restricted | B&B = home address. DAC7 per-listing address (10 y). Public on the listing while active. DUP: `host_onboarding`, Redis, MapTiler and PDOK queries, Stripe KYC. | `schema.ts:98-101` |
| Postgres | `properties` | `country` | host | Quasi | hold → retain-restricted | DAC7. | `schema.ts:102` |
| Postgres | `properties` | `location` (PostGIS point) | host | Direct | delete | Exact coordinates of a home. Column is NOT NULL, so in practice: set to the city centroid. | `schema.ts:104` |
| Postgres | `properties` | `stripe_account_id` | host | Linkable | hold → retain-restricted | DUP of `org_profile`. | `schema.ts:116` |
| Postgres | `properties` | `organization_id` | host | Linkable | hold → retain-restricted | Links the listing to the seller for DAC7. | `drizzle/0011_org_iam.sql:61` |
| Postgres | `properties` | `owner_user_id` | host | Linkable | delete | No FK. Names the founding owner. It no longer grants access once the property has an organisation (`packages/authz/src/index.ts:60,85`); on member removal or demotion it moves to a remaining owner, with the property's message threads (`packages/auth/src/owner-sync.ts:36`). Still read as the messaging contact and, for rows with no organisation, as the owner. | `schema.ts:112`; `packages/authz/src/index.ts:60,85`; `packages/auth/src/owner-sync.ts:36` |
| Postgres | `properties` | `subtitle` | host | Free text | delete | Host one-liner. | `schema.ts:131` |
| Postgres | `properties` | `timezone`, check-in/out times, `commission_rate`, `tax_rate`, `is_active`, `pin_set_manually`, timestamps | none | Non-personal | keep | Needed to read retained bookings. | `schema.ts:103-130` |
| Postgres | `property_content` | `overview_headline`, `overview_description`, `location_about`, `cta_headline`, `cta_body`, `fine_print` | host | Free text | delete | Marketing copy; B&B hosts often write about themselves. | `schema.ts:337-342` |
| Postgres | `property_content` | `contact_email` | host | Direct | delete | **Defaults to the host's login email** and is published. | `schema.ts:359`; `apps/business/app/(onboarding)/onboarding/promotion.ts:177-189` |
| Postgres | `property_content` | `contact_phone` | host | Direct | delete | Published. | `schema.ts:360` |
| Postgres | `property_content` | `legal_company_name`, `company_registration`, `vat_number` | host | Direct | delete | Published copies of `org_profile` (retained there). | `schema.ts:358,361-362` |
| Postgres | `property_content` | policy columns (`reception_24h` … `payment_methods`) | none | Non-personal | keep | | `schema.ts:345-355` |
| Postgres | `property_images` | `url` (and the R2 object, see 2.6) | host / third party | Direct | delete | Photos can show people and the inside of a home. | `schema.ts:426-436` |
| Postgres | `property_images`, `room_images` | `alt_text` | host | Free text | delete | | `schema.ts:434,448` |
| Postgres | `room_images` | `url` | host / third party | Direct | delete | As above. | `schema.ts:438-452` |
| Postgres | `rooms` | `description` | host | Free text | delete | Rooms must stay: retained reservations reference them. | `schema.ts:177` |
| Postgres | `rooms`, `rate_plans`, `rate_modifiers`, `property_highlights`, `amenities`, `payment_methods` | all other columns, incl. `rate_plans.cancellation_policy` | none | Non-personal | keep | Cancellation policy text describes terms, not people, and evidences the contract of retained bookings. | `schema.ts:169-386` |
| Postgres | `rate_overrides.created_by`, `rate_plan_restrictions.created_by`, `room_closures.created_by`, `room_inventory.updated_by` | user id | host / staff | Linkable | delete | No FK; set NULL. | `schema.ts:284,481,522,570` |
| Postgres | `room_inventory.note`, `rate_plan_restrictions.note`, `room_closures.note`, `rate_overrides.label` | free text | host / staff / third party | Free text | delete | Can name people ("owner use", "Mr X long stay"). | `schema.ts:268,479,520,568` |

### 2.4 Postgres: bookings and payments

Nothing creates `bookings` or `reservations` yet; only `packages/db/seed/demo-booking.ts` does. The booking lifecycle updates their status and writes `refunds`.

| System | Table/location | Field | Subject | Kind | Proposed outcome | Notes | Source |
|---|---|---|---|---|---|---|---|
| Postgres | `bookings` | `id` (booking reference) | guest | Linkable | hold → retain-restricted | Appears in URLs (`/bookings/<ref>`, `/checkout/confirmation/<ref>`), so in PostHog and Sentry. Also Chatwoot `linked_id`, Mistral tool results, Stripe `metadata.bookingIntentId`. | `schema.ts:585` |
| Postgres | `bookings` | `user_id` | guest | Linkable | hold → UNCLEAR | No FK. Keep only if fiscal records must identify the guest; otherwise replace with a tombstone (A1). | `schema.ts:590` |
| Postgres | `bookings` | `hotel_id` | host | Linkable | hold → retain-restricted | | `schema.ts:586-588` |
| Postgres | `bookings` | `check_in_date`, `check_out_date` | guest | Quasi | hold → retain-restricted | DAC7 (days rented per listing per quarter). With a small property, dates plus party size identify a stay; restrict access rather than coarsen during the period. | `schema.ts:591-592` |
| Postgres | `bookings` | `status`, `cancelled_at`, `no_show_reported_at`, `created_at`, `updated_at` | guest | Quasi | hold → retain-restricted | | `schema.ts:593-607` |
| Postgres | `bookings` | `total_amount`, `booking_fee_amount`, `currency` | guest | Quasi | hold → retain-restricted | Fiscal (7 y) and DAC7 consideration. | `schema.ts:594-596` |
| Postgres | `bookings` | `stripe_payment_intent_id` | guest | Linkable | hold → retain-restricted | Key to the payment on the host's Stripe account. | `schema.ts:597` |
| Postgres | `bookings` | `guest_notes` | guest | Free text | hold → delete | **Art. 9 risk** (dietary, accessibility, health). No writer yet. `pii-retention` nulls it after 18 months, but the job isn't scheduled. | `schema.ts:598`; `apps/business/app/api/cron/pii-retention/route.ts:29-38` |
| Postgres | `bookings` | `cancellation_reason` | guest / host | Free text | hold → delete | Also sent to Mistral and copied into Chatwoot escalation notes. The booking lifecycle now sets it to a fixed string ("Cancelled by the host/guest", `packages/db/src/booking-lifecycle/index.ts:386`); the column can still hold free text from other writers (U14). | `schema.ts:599`; `apps/support-bot/src/agent/tools.ts:118` |
| Postgres | `reservations` | `adults`, `children` | guest | Quasi | hold → coarsen | `children` reveals minors in the party. Coarsen to total party size once retained, unless the accountant needs the split (A1). | `schema.ts:631-632` |
| Postgres | `reservations` | `room_id`, `rate_plan_id`, `total_nights`, `price_per_night`, `total_amount`, `nights`, `policy_version`, `cancellation_tier`, `cancelled_at`, `created_at` | guest | Quasi | hold → retain-restricted | `nights` is JSON: the price and tourist tax of each night of the stay. | `schema.ts:625-640` |
| Postgres | `transactions` | `provider_payment_id`, `type`, `amount`, `currency`, `status`, `failure_code`, `created_at` | guest | Linkable | hold → retain-restricted | No writer in code. | `schema.ts:698-715` |
| Postgres | `transactions` | `failure_message` | guest | Free text | delete | Stripe decline text. | `schema.ts:712` |
| Postgres | `transactions` | `metadata` (JSONB) | guest | UNCLEAR | UNCLEAR | No writer and no type (U4). | `schema.ts:713` |
| Postgres | `refunds` | `created_by` | guest / host | Linkable | hold → retain-restricted | The guest or host user id that triggered the refund (NULL = the system). No FK. Part of the fiscal record of the refund (A1). | `drizzle/0027_cancellation_tiers.sql:81-101`; `packages/db/src/booking-lifecycle/index.ts:218` |
| Postgres | `refunds` | `booking_id`, `reservation_id`, `reason`, `accommodation_amount`, `tourist_tax_amount`, `amount`, `breakdown`, `status`, `stripe_refund_id`, `idempotency_key`, `created_at` | guest | Quasi | hold → retain-restricted | Money record of a refund on the host's Stripe account. `breakdown` is the calculator output (per-night amounts). `refunds_amounts_finite` rejects NaN amounts (`0030`). | `drizzle/0027_cancellation_tiers.sql:81-101`; `drizzle/0030_refunds_reject_nan.sql:14` |

### 2.5 Postgres: messaging, support, consent

| System | Table/location | Field | Subject | Kind | Proposed outcome | Notes | Source |
|---|---|---|---|---|---|---|---|
| Postgres | `message_threads` | `host_id`, `guest_id` | guest / host | Linkable | hold → delete | No FK. `host_id` follows `properties.owner_user_id` when the host leaves or is demoted, and readers re-check the host's current access to the property (`packages/authz/src/index.ts:184`). | `schema.ts:734-735` |
| Postgres | `message_threads` | `booking_id`, `property_id`, `status`, timestamps | guest / host | Quasi | hold → delete | `status = 'flagged'` records a suspected rule breach. | `schema.ts:729-739` |
| Postgres | `messages` | `body` | guest / host / third party | Free text | hold → delete | **Art. 9 risk.** System of record for host–guest chat. A 365-day anonymiser exists (`runRetention`) but isn't scheduled (U18); it keys on the body, not on `sender_id`, so a deleted guest's messages are swept too, and it keeps `flagged_reason` and thread metadata. A guest who deletes their account has their own messages redacted at once (`apps/web/lib/account/deletion.ts:39`); host replies in the thread stay until the sweep. | `schema.ts:654`; `packages/messaging/src/routes.ts:277-296`; `packages/messaging/src/redaction.ts:15` |
| Postgres | `messages` | `sender_id` | guest / host | Linkable | hold → delete | NULL for a deleted guest's messages. | `schema.ts:757` |
| Postgres | `messages` | `flagged_reason`, `sender_role`, `read_at`, `notified_at`, `created_at` | guest / host | Quasi | hold → delete | `flagged_reason` = detected phone, email or messenger handle. | `schema.ts:759-765`; `packages/messaging/src/circumvention.ts:34-40` |
| Postgres | `processed_events` | `event_id`, `processed_at`, `replied_at` | guest / host | Linkable | delete | Chatwoot message ids and Stripe event ids. Can't be found per person; purge by age (none exists). | `schema.ts:781-786`; `drizzle/0006_support_bot.sql:18-27` |
| Postgres | `support_context_cache` | `turns` (JSON `[{role, content}]`) | guest / host / third party | Free text | delete | **Art. 9 risk.** Verbatim chat turns plus bot replies that repeat booking data. 6 h TTL on read only; rows never deleted. Keyed only by Chatwoot conversation id, so finding a person's rows needs a Chatwoot lookup. | `schema.ts:793-799`; `apps/support-bot/src/process.ts:32,98-109,151-161` |
| Postgres | `support_context_cache` | `conversation_id`, `updated_at` | guest / host | Linkable | delete | | `schema.ts:795-798` |
| Postgres | `support_contacts` | `chatwoot_contact_id` | host / staff | Linkable | delete | Cascades on user delete; the Chatwoot contact itself doesn't (2.7). | `schema.ts:809-816` |
| Postgres | `support_contacts` | `source_id`, `pubsub_token` | host / staff | Linkable | delete | Chatwoot credentials. `source_id` also leaks to the browser in websocket payloads. | `schema.ts:812-813`; `packages/support/README.md:37` |
| Postgres | `support_tickets` | `opened_by_user_id` | host / staff | Linkable | delete | FK already `ON DELETE SET NULL`. | `drizzle/0025_business_support.sql:33` |
| Postgres | `support_tickets` | `title` | host / staff / guest | Free text | delete | When no item is linked: first line of the host's message (≤60 chars). | `apps/business/lib/support/title.ts:14-31` |
| Postgres | `support_tickets` | `last_message_preview` | host / staff / guest | Free text | delete | 140 chars of the latest message from either side. Hosts paste guest data (README). | `packages/db/src/support-tickets.ts:28-35,174-191` |
| Postgres | `support_tickets` | `linked_id` | guest | Linkable | delete | Booking UUID when `linked_type = 'booking'`. | `schema.ts:835` |
| Postgres | `support_tickets` | `chatwoot_conversation_id`, `category`, `status`, `organization_id`, `property_id`, timestamps | host | Non-personal | keep | The ticket belongs to the organisation once the opener is removed. | `schema.ts:823-859` |
| Postgres | `support_ticket_reads` | `user_id`, `last_seen_at` | host / staff | Linkable | delete | Cascades on user delete. | `schema.ts:862-872` |
| Postgres | `consent_log` | `user_id` | guest / host / staff | Linkable | delete | Set to NULL when a guest deletes their account (`apps/web/lib/account/deletion.ts:39`). **Not implemented for hosts.** | `schema.ts:911-935`; `drizzle/0017_consent_log.sql:12-16` |
| Postgres | `consent_log` | `consent_id` | guest / host / staff | Linkable | keep | Random device id. Identifies no one in our systems once `user_id` is nulled; still matches the device's `ob_cookie_consent`. Evidence under Art. 7(1) (L3). | `schema.ts:926` |
| Postgres | `consent_log` | `event_type`, `categories`, `banner_version`, `app`, `idempotency_key`, `expires_at`, `created_at` | none | Non-personal | keep | No IP or user agent, by design. | `schema.ts:928-938` |

### 2.6 Object storage, Durable Objects, caches, queues

| System | Table/location | Field | Subject | Kind | Proposed outcome | Notes | Source |
|---|---|---|---|---|---|---|---|
| Cloudflare R2 | bucket `R2_BUCKET_NAME`, key `uploads/<owner tag>/<uuid>.{jpg,png,webp}` | image object (property, room, logo) | host / third party | Direct | delete | **Public, unsigned** via `cdn.openbookings.co`. The key carries a tag derived from the uploading host's user id (not reversible; shared by all of that host's uploads), so objects are found through `property_images` / `room_images.url`. **Never deleted** (row delete keeps the object; abandoned presigned uploads also remain). Original bytes, no EXIF stripping (GPS, device, U24). | `apps/business/lib/s3.ts:61-67`; `apps/business/lib/upload-policy.ts:29`; `apps/business/app/api/upload/presign/route.ts:36-52`; `apps/business/app/api/upload/confirm/route.ts:45-50`; `apps/business/app/api/property-images/[id]/route.ts:66-68` |
| Cloudflare Durable Objects | `ob-durableobjects`, storage `pending:<messageId>` | `{messageId, threadId, recipientId, deadline}` | guest / host | Linkable | UNCLEAR | Per prior audit: 5-min TTL, deleted on alarm, EU jurisdiction. Source not in repo; not re-verified (U1). | `docs/compliance/COMPLIANCE_AUDIT.md:115`; `packages/messaging/src/realtime.ts:27-58` |
| Cloudflare Durable Objects | `/deliver` request body, WebSocket push | full message row (incl. `body`), `recipientId`, `threadId` | guest / host | Free text | n/a | In transit only, per prior audit. | `packages/messaging/src/realtime.ts:50-58` |
| Cloudflare Durable Objects | WebSocket URL query `?token=` | `<userId>.<expiresAt>.<signature>` | guest / host | Linkable | n/a | User id in a URL; could appear in Cloudflare request logs (U19). | `packages/messaging/src/realtime.ts:20-25`; `packages/messaging/src/client.ts:141` |
| Upstash Redis | `ob:v1:prop-page:<slug>` | cached public listing payload: address, coordinates, contact email/phone, legal name, KvK, VAT | host | Direct | delete | 1-day physical TTL; purged on edit by `purgePropertyPage`. A deletion must purge it. | `packages/cache/src/keys.ts:21-23`; `apps/web/lib/hotel-page-query.ts:100-117`; `apps/web/lib/hotel-page-data.ts:47` |
| Upstash Redis | `ob:v1:purged:<key>` | purge timestamp | none | Non-personal | keep | | `packages/cache/src/keys.ts:32-34` |
| Upstash QStash | `process-conversation` task body | `content`, `guestEmail`, `hostUserId`, `conversationId`, `messageId`, `ticket{category, linkedType, linkedId}` | guest / host | Direct | delete | Message text plus guest email leave our infrastructure for the queue. Retention and region unknown (U12). | `apps/support-bot/src/tasks.ts:14-44,99-114`; `apps/support-bot/src/index.ts:139-156` |
| Upstash QStash | `support-reply-notify` task body | `conversationId`, `messageAt` | host | Linkable | delete | | `apps/support-bot/src/tasks.ts:46-50` |

### 2.7 Third parties

| System | Table/location | Field | Subject | Kind | Proposed outcome | Notes | Source |
|---|---|---|---|---|---|---|---|
| Stripe | Connected account (create) | `email`, `business_profile.name`, `country`, `metadata.openbookings_user_id` | host | Direct | hold → retain-restricted | Host login email and legal name. The metadata stamp is our user id; completion refuses an account stamped for someone else. It is visible in the host's Stripe Dashboard. Accounts created before the stamp carry none. | `packages/stripe/src/connect/accounts.ts:18,58`; `apps/business/app/(onboarding)/onboarding/actions.ts:236,309` |
| Stripe | Connected account KYC (Stripe-hosted onboarding) | legal name, DOB, ID document, home address, IBAN, tax ID | host | Direct | n/a | Collected and held by Stripe as controller; never passes through our code. | `packages/stripe/src/connect/accounts.ts:20-33` |
| Stripe | Checkout Session on the host's account | `customer_email` | guest | Direct | hold → retain-restricted | Lives on the **host's** account and Dashboard; we can read it but not delete it (finding 4). | `packages/stripe/src/payments/checkout.ts:48-50`; `apps/web/app/api/checkout/route.ts:246` |
| Stripe | Checkout Session on the host's account | billing name and address, phone | guest | Direct | n/a | Collected by Stripe (`billing_address_collection: 'required'`, `phone_number_collection`) for the host. Host/Stripe are the controllers to address. | `packages/stripe/src/payments/checkout.ts:59-63` |
| Stripe | Checkout Session | `line_items.product_data` (property name, room name) | guest | Quasi | hold → retain-restricted | | `apps/web/app/api/checkout/route.ts:250-255` |
| Stripe | Checkout Session `metadata` | `bookingIntentId`, `roomId`, `userId`, `totalCents` | guest | Linkable | hold → retain-restricted | Our internal user id is visible to the host in their Stripe Dashboard. | `apps/web/app/api/checkout/route.ts:259-272` |
| Stripe | Card data | PAN, CVC | guest | Direct | n/a | Never reaches our servers (`ui_mode: 'form'`). | `packages/stripe/src/payments/checkout.ts:47` |
| Stripe | Webhook `account.external_account.*` (read) | `last4`, bank `country` | host | Quasi | retain-restricted | Copied into `audit_log.detail` and the payout-alert email. | `apps/business/lib/stripe-events.ts:99-113` |
| Chatwoot | Contact (Business support inbox) | `identifier` (= our user id), `identifier_hash`, `name`, `email` | host / staff | Direct | delete | Created on first ticket. Name falls back to email. No deletion call exists. | `packages/support/src/client-api.ts:58-79`; `apps/business/lib/support/server/service.ts:69-72`; `apps/business/lib/support/server/tickets.ts:53-54` |
| Chatwoot | Conversation `custom_attributes` | `category`, `org_id`, `property_id`, `linked_type`, `linked_id` (booking UUID), `follow_up_of`, `route`, `app_version`, `replay_url` | host / guest | Linkable | delete | `replay_url` is a PostHog session-recording link. Only https `posthog.com` links are accepted for it and only in-app paths for `route` (`apps/business/lib/support/safe-attributes.ts:11,25`). | `apps/business/lib/support/server/service.ts:129-139`; `apps/business/components/support/support-provider.tsx:392` |
| Chatwoot | Messages and attachments (host tickets) | text; images/PDF/HEIC up to 5 × 10 MB | host / staff / guest | Free text | hold → delete | **Art. 9 risk.** Hosts can paste guest data or attach screenshots and ID scans. Retention is set in Chatwoot, not here (U11). | `apps/business/lib/support/server/service.ts:159-163`; `apps/business/lib/support/attachments.ts:6-10` |
| Chatwoot | Bot replies | Mistral output | guest / host | Free text | delete | Can repeat booking details. | `packages/support/src/application.ts:48-54` |
| Chatwoot | Private escalation notes | reason, tool names, args, JSON results (≤500 chars each) | guest | Direct | delete | Host tickets include the guest's full name; guest tickets include dates, amounts and `cancellation_reason`. The reason and tool text are sanitised (no line breaks, markdown escaped, links and @-mentions broken, length capped) but the tool arguments and results are still included. | `apps/support-bot/src/escalation-note.ts:26,47`; `apps/support-bot/src/process.ts:85` |
| Chatwoot | Guest website-widget inbox | contact email, messages | guest | Direct | delete | The widget isn't embedded anywhere in this repo, but the bot serves that inbox. Where is it live? (U10) | `apps/support-bot/src/index.ts:107-115`; `packages/support/README.md:15` |
| Mistral | Chat completion `messages` | system prompt + up to 20 verbatim turns | guest / host / third party | Free text | delete | Whatever the person typed. | `apps/support-bot/src/agent/loop.ts:96-100,164-174`; `apps/support-bot/src/process.ts:35,109` |
| Mistral | Tool results (guest agent) | booking ref, status, dates and times, amounts, property name/city/country, `cancelled_at`, `cancellation_reason`, rooms (adults, children, nights, prices, policy), payment status and refunds | guest | Quasi | delete | No email: identity stays server-side. | `apps/support-bot/src/agent/tools.ts:106-129,201` |
| Mistral | Tool results (host agent) | as above plus `guest_name` (full `user.name`), `created_at`, `booking_fee_amount` | guest | Direct | delete | The host prompt says not to repeat guest contact details, but the name is sent. | `apps/support-bot/src/host/tools.ts:38-63`; `apps/support-bot/src/host/queries.ts:59` |
| Mistral | Second system message (host tickets) | category, linked booking or property id | host | Linkable | delete | | `apps/support-bot/src/host/prompt.ts:21-36` |
| PostHog | `identify(userId)` (browser, after consent) | distinct_id = user UUID | guest / host / staff | Linkable | delete | No erasure script exists any more (removed in #143); deletion is manual in the PostHog dashboard. | `packages/analytics/src/client.tsx:355-388` |
| PostHog | `$pageview` | `$current_url` = full URL | guest / host / staff | Linkable | delete | Includes booking refs, `session_id=cs_…`, search query strings, `?error=` codes. | `packages/analytics/src/client.tsx:269-281` |
| PostHog | `search_initiated`, `destination_selected` | `destination`, `check_in`, `check_out`, `adults`, `children`, `rooms`; `city`, `country` | guest | Quasi | delete | Consent-gated. | `apps/web/components/search/SearchBar.tsx:133-140`; `apps/web/components/plug-in/SearchBar.tsx:122` |
| PostHog | Other browser events (guest auth, host editor) | `error_code`, `provider`, `method`, `group`, `section`; `release` super property | guest / host / staff | Non-personal | delete | Personal only through the distinct_id. | `apps/web/components/auth/AuthFormFields.tsx:126-188`; `apps/business/app/(dashboard)/dashboard/listings/**`; `packages/analytics/src/client.tsx:315-317` |
| PostHog | Session replay | DOM recording, inputs and text masked (`maskTextSelector: '*'`) | guest / host / staff | Quasi | delete | Enabled or not by the project setting, not by code (U9). Replay URLs go to Chatwoot. | `packages/analytics/src/client.tsx:302-305` |
| PostHog | `magic_link_sent`, `business_magic_link_sent` (server) | `distinctId = email`, `properties.email` | guest / host / staff | Direct | delete | **Not consent-gated.** Fires for people who never complete sign-up. Cannot be erased by us: no script exists (finding 1). | `apps/web/app/api/auth/login-link/route.ts:85-95`; `apps/business/app/api/auth/login-link/route.ts:99-109` |
| PostHog | `hotel_search_completed`, `hotel_search_failed` (server) | `lat`, `lon`, `checkin`, `checkout`, `adults`, `children`, `rooms`, `error_message` | guest | Quasi | keep | Not consent-gated, but every event shares `distinctId "anonymous"` because no client sets `x-posthog-distinct-id`. Becomes attributable if that header is ever set. | `apps/web/app/api/query/route.ts:329,347-370` |
| Sentry | Error and request events (6 configs, 2 apps) | stack, request URL, breadcrumbs, browser/OS | guest / host / staff | Linkable | delete | No `beforeSend`, `sendDefaultPii` unset (SDK default false), no `setUser`. Exact request payload from `captureRequestError` is U8. Support bot has no Sentry. | `apps/web/sentry.server.config.ts`; `apps/business/sentry.*.config.ts`; `apps/*/instrumentation.ts` |
| Sentry | Explicit `extra` | `intentId` (booking id), `roomId`, `sessionId` (Stripe `cs_…`), error `code` | guest | Linkable | delete | Vendor retention only. | `apps/web/app/api/checkout/route.ts:301`; `apps/web/app/checkout/return/page.tsx:139,170`; `apps/web/app/checkout/_components/PaymentCard.tsx:132` |
| Sentry | Performance traces | `tracesSampleRate: 1` (100 %), span URLs | guest / host / staff | Linkable | delete | | all `sentry.*.config.ts` |
| Lettermint | Magic-link email | recipient, email in body, sign-in URL with token | guest / host / staff | Direct | delete | Provider log retention unknown (U12). | `packages/mailing/src/templates/index.ts:53,60`; `apps/business/lib/mailing/magic-link.ts:7-17`; `apps/web/lib/mailing/magic-link.ts` |
| Lettermint | Security alert | account email, device (from UA), city/region/country, IP, time; sent to the signer **and every org owner** | host / staff | Direct | delete | | `apps/business/lib/mailing/security-alert.ts:70-122`; `packages/auth/src/host.ts:201-224` |
| Lettermint | Payout-change alert | org name, change, bank last4, bank country; to owners | host | Quasi | delete | | `apps/business/lib/mailing/payout-change-alert.ts:49-100` |
| Lettermint | Support reply notification | first name, ticket number, link with ticket UUID | host / staff | Direct | delete | No message content, by design. | `apps/support-bot/src/support/notify.ts:23-86` |
| Tirreno | `POST /sensor/` per host sign-in | `userName` (= user id), `ipAddress`, `userAgent`, `eventTime`, `eventType` | host / staff | Linkable | delete | No deletion call exists. Region and retention unknown (U13). | `apps/business/lib/tirreno.ts:7-34`; `packages/auth/src/host.ts:192-200` |
| Cloudflare Turnstile | siteverify | token, `remoteip` (guest IP) | guest | Linkable | n/a | Checkout only. | `apps/web/app/checkout/_lib/turnstile.ts:90-95` |
| Cloudflare edge | Proxy/CDN for all apps | IP, URL, headers; geolocation headers read for security alerts | guest / host / staff | Linkable | UNCLEAR | Log retention is outside the repo (U19). | `packages/auth/src/location.ts:27-41` |
| MapTiler | Geocoding API (browser) | address typed by the host, host IP | host | Direct | n/a | Onboarding and listing editor; map tiles in both apps. | `apps/business/app/(onboarding)/onboarding/_steps/core-info-location.tsx:101-104`; `apps/business/app/(dashboard)/dashboard/listings/property/_lib/address-lookup.ts:158-160,226,287` |
| PDOK (Dutch government) | Locatieserver (via our server) | postcode + house number | host | Direct | n/a | Proxied so PDOK sees our IP. Not in any vendor list. | `apps/business/app/api/address-lookup/nl/route.ts:11-42` |
| Algolia | Search (browser) | destination keystrokes, IP | guest | Quasi | n/a | Read-only index; no writes in the repo. | `apps/web/lib/algolia.ts`; `apps/web/components/plug-in/SearchBar.tsx:190-196` |
| OAuth IdPs | Google, Apple (guest); Google (host) | sign-in; we receive email, name, picture, subject id | guest / host / staff | Direct | n/a | IdP is controller of its own copy. Microsoft was a host provider until 3 November 2026; its stored data is still in `account` (finding 7). | `packages/auth/src/guest.ts:121-138`; `packages/auth/src/host.ts:373-385` |

### 2.8 Browser storage and cookies

| System | Table/location | Field | Subject | Kind | Proposed outcome | Notes | Source |
|---|---|---|---|---|---|---|---|
| Browser | Cookie `__Host-ob-guest.session_token` / `__Host-ob-host.session_token` | session token | guest / host / staff | Linkable | delete | Invalidated server-side by deleting `session`. | `packages/auth/src/shared.ts:242-267` |
| Browser | Cookie `__Host-ob-*.session_data` | signed session + user cache (5 min guest, 60 s host) | guest / host / staff | Direct | n/a | Per Better Auth defaults this carries the user object (name, email, image); not verified (U20). | `packages/auth/src/shared.ts:370-374`; `packages/auth/src/host.ts:241-244` |
| Browser | Cookies `__Host-ob-*.account_data`, `…dont_remember`, OAuth state cookies | Better Auth internals | guest / host / staff | UNCLEAR | n/a | `account_data` contents unknown (U20). | `packages/auth/src/shared.ts:117,260-265` |
| Browser | Cookie `sidebar_state` (business) | UI state | none | Non-personal | n/a | | `apps/business/components/ui/sidebar.tsx:86` |
| Browser | PostHog `ph_*` cookie and localStorage | distinct_id, session id | guest / host / staff | Linkable | n/a | Only after consent; removed on withdrawal. | `packages/analytics/src/client.tsx:59-80` |
| Browser | localStorage `ob_cookie_consent` | `{v, exp, h, ver, cid}` | guest / host / staff | Linkable | n/a | `cid` = `consent_log.consent_id`. | `packages/analytics/src/consent-device.ts:13-22` |
| Browser | localStorage `ob_consent_outbox` | queued consent events | guest / host / staff | Linkable | n/a | | `packages/analytics/src/consent-outbox.ts:17` |
| Browser | localStorage `ob_consent_linked` | `<consentId>:<userId>` | guest / host / staff | Linkable | n/a | Ties the device to the account; stays after sign-out. | `packages/analytics/src/client.tsx:42,233-249` |
| Browser | Device passkey store (iCloud Keychain, Google Password Manager) | account name = host email | host / staff | Direct | n/a | Forced to the email for every passkey. | `packages/auth/src/passkey-account-name.ts:5-23` |
| Browser | Stripe.js and Turnstile third-party cookies on checkout | device identifiers | guest | Linkable | n/a | Whether consent covers these is U21. | `apps/web/next.config.ts:32-38` |
| Browser | Chatwoot websocket | `pubsub_token`; `source_id` in event payloads | host / staff | Linkable | n/a | | `packages/support/README.md:36-37` |

Non-personal localStorage keys, not listed per row: `ob_backgrounds`, `ob-passkey-on-device`, `ob-passkey-nudge-dismissed`, `ob:nav-seen`, `system-status-summary`.

### 2.9 Logs

| System | Table/location | Field | Subject | Kind | Proposed outcome | Notes | Source |
|---|---|---|---|---|---|---|---|
| App logs | `trace()` in support bot and `@openbookings/support` | webhook bodies, tool args and results, Chatwoot request bodies | guest / host | Free text | n/a | Dev only: off when `NODE_ENV=production`, which the support-bot Dockerfile sets. A staging deploy without it would log full message content and booking data. | `apps/support-bot/src/trace.ts:8-17`; `packages/support/src/trace.ts:6-13`; `apps/support-bot/Dockerfile:54` |
| App logs | `[login-link] signInMagicLink failed:` | raw error object | guest / host / staff | UNCLEAR | UNCLEAR | Whether Lettermint or Better Auth errors include the recipient email (U22). | `apps/web/app/api/auth/login-link/route.ts:81`; `apps/business/app/api/auth/login-link/route.ts:95` |
| App logs | `Tool %s failed` | raw DB or Stripe error | guest / host | UNCLEAR | UNCLEAR | Postgres constraint errors can echo values. | `apps/support-bot/src/agent/tools.ts:291` |
| App logs | `Realtime delivery failed` | worker response body | guest / host | UNCLEAR | UNCLEAR | U23. | `packages/messaging/src/realtime.ts:60` |
| App logs | `[onboarding] property promotion skipped` | `userId` | host | Linkable | delete | Platform log retention. | `apps/business/app/(onboarding)/onboarding/actions.ts:336-339` |
| Ops scripts (stdout) | Stripe test cleanup | connected-account emails | host / guest | Direct | n/a | Manual CLI output; terminal history only. The backfill and PostHog-delete scripts were removed in #143. | `packages/stripe/scripts/discard-test-accounts.ts:42` |

Logging that was checked and is clean: `consent-route.ts` logs error name and message only; Stripe webhook logs event type and id only; checkout logs error code and message only; the cache logs the slug key only.

---

## 3. Third-party data flows

| Vendor | What goes there | How a person is identified there | Can we delete it today? |
|---|---|---|---|
| **Stripe** | Host: email, legal name, country and our user id (as account metadata) at account creation; Stripe collects KYC itself. Guest: email (prefilled), billing name and address, phone, card, booking line items, `metadata.userId`. | Host: connected account id (`acct_…`, stored in 4 places). Guest: email and `metadata.userId`, on the **host's** account. | Not by us. Guest data sits on the host's account; host KYC is Stripe's as controller. |
| **Chatwoot** (self-hosted) | Host contact (user id, name, email); ticket attributes incl. booking id and PostHog replay URL; message text and attachments; bot replies; escalation notes with booking data and guest name. Guest widget conversations (email, text), if live. | Host: contact `identifier` = our user id (HMAC-verified), plus email. Guest: contact email. | No code path. Would need the Application API (contact and conversation delete) or a manual admin action. |
| **Mistral** | Up to 20 verbatim turns per reply; tool results with booking data; host tickets add guest full name. Never the guest's email. | Not by an identifier: personal data is in the content. | No; depends on Mistral's retention and training terms (U12). |
| **Upstash QStash** | Each guest or host chat message, the guest's email, the host's user id. | Email or user id inside payloads. | No code path; vendor retention (U12). |
| **Upstash Redis** | Public listing payload (host address, coordinates, contact details, legal and VAT data). | Property slug. | Yes: `purge()` exists; must be called on deletion. |
| **PostHog** (EU) | Browser (consented): user UUID, full-URL pageviews, search parameters, events, session replay. Server (**not consented**): email as distinct id on magic-link requests; anonymous search events. | User UUID **and** raw email (two different persons). | No: the erasure script was removed (#143). Manual deletion in the PostHog dashboard only, for UUID-keyed and email-keyed persons alike. |
| **Sentry** | Errors and 100 % traces from both apps, with URLs and booking/session ids in `extra`. | No user context set; booking id or URL only. | Not per person; retention-based (region U8). |
| **Lettermint** | Magic links (email + token URL), security alerts (IP, city, device, to all owners), payout alerts, support reply notices. | Recipient email. | No code path; provider log retention (U12). |
| **Tirreno** (self-hosted) | Every host sign-in: user id, IP, user agent. | `userName` = our user id. | No code path. |
| **Cloudflare** | All traffic (proxy and CDN); R2 images; Durable Object relay (full message rows in transit, user id in WebSocket URL); Turnstile (guest IP at checkout); image transforms. | IP; user id (realtime token); none for R2. | R2: yes via S3 API, but not wired up. Logs: dashboard settings (U19). |
| **MapTiler** | Host address queries from the browser; tiles. | Host IP. | n/a. |
| **PDOK** | Host postcode + house number via our server. | None (our IP). | n/a. |
| **Algolia** | Guest destination keystrokes. | Guest IP. | n/a. |
| **Google / Apple** (Microsoft until 3 Nov 2026) | Sign-in redirects. We store their tokens (Section 4), including those of Microsoft accounts created before it was removed. | Provider subject id (`account.accountId`). | Our copy: yes (delete `account`). Theirs: n/a. |
| **Neon / Scaleway** | Everything in Postgres; container logs. | Every identifier above. | Neon branch snapshots and point-in-time restore keep deleted rows for the retention window (L11). |
| **DocuSeal, Gotenberg, pgvector** | Nothing. Not referenced in code; agreements are click-signed into `org_consent`. | n/a | n/a |

---

## 4. Collection to reconsider

### Probably shouldn't be collected or kept

- **Email in server-side PostHog events.** Drop `properties.email` and use no distinct id, or the user UUID only after sign-in and consent. (`apps/*/app/api/auth/login-link/route.ts`)
- **OAuth `accessToken`, `refreshToken`, `idToken`.** The app never calls the providers after sign-in. Either stop storing them or turn on Better Auth's token encryption and clear them after the account is linked. **Delete the legacy Microsoft rows** (`DELETE FROM account WHERE "providerId" = 'microsoft'`; those users still sign in by magic link) and drop `account.tenant_id`.
- **`host_onboarding.step_data` after completion.** Clear the legal and location blocks once `completeOnboarding` has copied them, and stop keeping `previousAttempts[]`. (`saveStepData` input is now validated; see finding 8.)
- **Full URLs in PostHog `$pageview`.** Send the route pattern (`/bookings/[ref]`) and strip query strings; or use PostHog's `before_send` to redact path ids and `session_id`.
- **PostHog replay URL in Chatwoot.** It links the two vendors and puts a recording of the host's session into the support tool. Make it opt-in per ticket, or leave it out.
- **Copies of tool results in Chatwoot escalation notes.** Note the booking reference and the reason; agents can look the rest up.
- **Guest full name to Mistral on host tickets.** The booking reference and dates identify the booking; the model doesn't need the name.
- **Staff IP and city in emails to every owner.** Send owners "new device for Anna: Chrome on macOS" and give the IP and location only to the signer.
- **`audit_log.user_agent`.** New-device detection only needs a hash of the user agent.
- **EXIF metadata in uploaded originals.** Re-encode on upload (or confirm; see U24), and delete R2 objects when the row goes.
- **Login email as default public `contact_email`.** Ask hosts to enter a contact address, prefilled but visibly editable, and say it will be public.

Not collected, and good to keep that way: guest passport or ID data, date of birth, full card data. (Check that host support attachments don't become a channel for guest ID scans: add a warning in the attach dialog.)

### Better structured than free text

| Field | Today | Suggestion |
|---|---|---|
| `bookings.guest_notes` | Free text (not yet written) | Structured fields: arrival time, bed preference, "I have an accessibility need" checkbox (with Art. 9 explicit consent and short retention) instead of open text. |
| `bookings.cancellation_reason` | Free text | Enum of reasons plus an optional note that the retention job clears. |
| `room_inventory.note`, `room_closures.note`, `rate_plan_restrictions.note` | Free text | Enum (maintenance, owner use, renovation, other) plus a short optional note. |
| `support_tickets.title` | First line of the host's message | Category + linked item label only (already the rule when an item is linked). |
| `support_tickets.last_message_preview` | 140 chars of message text | Store sender and time only; show "New message" in the list, or fetch the preview from Chatwoot on view. |
| `user.banReason`, `audit_log.reason` | Free text | Reason code plus ticket reference. |

### Minimise or deduplicate

- **Email** is held in about 12 places (Section 2, `user.email`). The ones we control and don't need: `verification.value` after expiry, `property_content.contact_email` default, PostHog server events, QStash payloads (pass the conversation id and look the email up in the task handler).
- **Legal identity** (legal name, VAT, KvK) lives in `host_onboarding`, `org_profile`, `organization.name`, `property_content` and Stripe. Keep `org_profile` as the single source; make `property_content` a view of it or a reference.
- **Stripe account id** lives in `host_onboarding.step_data`, `org_profile`, `properties` and `audit_log.detail`. Keep `org_profile` only.
- **Exact coordinates** on `properties.location`: needed for search and the map while the listing is live, not after.
- **`reservations.children`**: needed for pricing at booking time; coarsen to party size when the booking enters retention.
- **Signature IPs** in `org_consent` and `host_onboarding`: currently the first `x-forwarded-for` hop. Use `cf-connecting-ip`, as Better Auth does, or drop the IP if the lawyer says the signed-in session is evidence enough.
- **Retention jobs:** schedule `messaging-retention` and `pii-retention`, and add purges for `support_context_cache` (> 6 h), `processed_events` (> 30 d), expired `verification` rows, and `audit_log.ip`/`user_agent` (> N months).

### Gaps found while mapping (collected too little, flagged for completeness)

DAC7 needs fields that aren't collected: seller TIN, date of birth for individual sellers, primary address, and land-registry number. Stripe holds some of these, but they aren't in our database. When they're added, they're `retain-restricted` (10 y) from day one.

---

## 5. Open questions

### UNCLEAR items (26)

| # | Item | What would resolve it |
|---|---|---|
| U1 | What the `ob-durableobjects` worker stores, and for how long. Prior audit (28 Sep) says IDs only, 5-min TTL, EU jurisdiction; not re-verified. | Read the worker's repo or the deployed bundle; list DO storage keys. |
| U2 | Contents of `organization.logo` and `organization.metadata`. No writer in the repo. | `SELECT count(*) … WHERE logo IS NOT NULL OR metadata IS NOT NULL` on the live DB. |
| U3 | Whether `team` / `teamMember` exist live and hold rows. | Live schema dump and row count. |
| U4 | Shape of `transactions.metadata`. No writer, no type. | Decide the shape before the first writer ships; check live rows. |
| U5 | What else is in `host_onboarding.step_data` beyond the typed keys. Input was unvalidated until 3 November 2026, so older rows may hold stray or forged keys (a changed `stripe_account_id`, edited legal records). | `SELECT DISTINCT jsonb_object_keys(step_data)` and per-step keys on the live DB. |
| U6 | Whether Better Auth deletes expired `verification` rows (each holds an email). | Count rows with `"expiresAt" < now()`; check the installed version's cleanup behaviour. |
| U7 | Whether `account.password` is NULL everywhere, and what Apple (and, on legacy rows, Microsoft) put in stored tokens. | Live query; decode one sample token per provider (in a safe environment). |
| U8 | What Sentry's `captureRequestError` sends with `sendDefaultPii` unset (headers, query strings), and which Sentry region the DSN points to. | Inspect one live event; check the DSN host. |
| U9 | PostHog project settings: IP capture and GeoIP, session replay on or off, console-log capture, person profiles. | PostHog project settings page. |
| U10 | Where the guest Chatwoot website widget is embedded, if anywhere. If live, guest emails and messages go to Chatwoot, QStash and Mistral, which the guest privacy policy excludes (`apps/web/lib/legal/documents.test.ts:53`). | Check the Chatwoot inbox list and any site that loads the widget. |
| U11 | Chatwoot's region, conversation retention, and where attachments are stored (disk vs S3/R2). | Chatwoot instance config. |
| U12 | Retention and region for Mistral (and training opt-out), Upstash QStash message logs, and Lettermint sent-mail logs. | Vendor DPAs and dashboards. |
| U13 | Whether Tirreno is configured in production, and its region and retention. | Check `TIRRENO_URL` in the production env; Tirreno instance settings. |
| U14 | Where `bookings.guest_notes` and `cancellation_reason` will come from (guest form, host, support). | Product decision before booking creation ships. |
| U15 | Who sends the guest's booking confirmation email. The return page promises one (`apps/web/app/checkout/return/page.tsx:41`); no sender exists in code. | Confirm whether Stripe receipts from the host's account are relied on, or a Lettermint template is planned. |
| U16 | Planned source of `guestCountry` in host analytics (currently demo data only). | Product decision (Stripe billing address? Account profile?). |
| U17 | Whether the live database matches the repo. `message_threads` and `messages` came from migrations not in the repo, and the DDL snapshot is stale. | `pg_dump --schema-only` diffed against this map. |
| U18 | Whether `messaging-retention` and `pii-retention` run on any schedule in production. | Scaleway console (cron or serverless jobs). |
| U19 | Retention of Cloudflare and Scaleway request logs, which carry IPs, booking refs in URLs, Checkout Session ids, magic-link callback URLs and realtime tokens. | Cloudflare Logs/Logpush settings; Scaleway Cockpit retention. |
| U20 | What the `session_data` and `account_data` cookies contain under Better Auth 1.7. | Decode a cookie from a test session. |
| U21 | Whether Stripe.js and Turnstile set cookies on checkout, and whether the cookie banner covers them. | Browser devtools on `/checkout`; cookie policy text. |
| U22 | Whether a failed magic-link send logs the recipient's email. | Trigger a send failure in staging and read the log line. |
| U23 | What the realtime worker returns in error bodies (logged verbatim). | Worker source (see U1). |
| U24 | Whether original images in R2 carry EXIF GPS or device data, and whether the R2 bucket issue from the prior audit (empty bucket list) is resolved. | Download a few originals and inspect EXIF; list buckets in the right Cloudflare account. |
| U25 | Which organisations, properties and slugs carry a natural person's name (sole traders, B&Bs). Treated as personal throughout. | Spot-check live `organization.name` and `properties.name`; record `business_type` from Stripe. |
| U26 | Whether any stored VAT numbers are pre-2020 Dutch sole-trader numbers that embed a BSN. | Pattern check on `org_profile.vat_number` (`NL` + 9 digits + `B01`-style suffix against known BSN-era formats); ask the accountant. |

### Questions for the accountant

- **A1.** Bookings are direct charges: the host is the merchant, and our revenue is the application fee (commission). Which booking data must **we** keep for 7 years? Is booking id + listing + dates + amounts + fee enough, or must our records identify the guest (`bookings.user_id`, email)? Do we need the adults/children split?
- **A2.** There's no invoicing code yet. What must a commission invoice to a host contain (legal name, address, VAT id for reverse charge, KvK), and is the 7-year period counted from the end of the financial year the invoice falls in?
- **A3.** Do `audit_log` entries for commission refunds and disputes count as part of the bookkeeping, so that they fall under the 7-year duty?
- **A4.** DAC7: confirm the 10-year retention under the Dutch implementation, and which fields it covers (seller identity, TIN, DOB, address, financial account identifier, per-listing address, land-registry number, consideration and days rented per quarter, fees). Several aren't collected yet.
- **A5.** If a host deletes their account mid-quarter, what is the minimum we keep to file that quarter's DAC7 report?

### Questions for the lawyer

- **L1.** Guest data on the host's Stripe account (email, phone, billing address) and in the host's dashboard: who is controller, and how is a guest's deletion request routed to the host and Stripe? Does the Partner Agreement/DPA need to say so?
- **L2.** How long may we keep `org_consent` (signer name, role, IP) after a host leaves? Is the Dutch 5-year limitation period for contractual claims (art. 3:307 BW) the right yardstick?
- **L3.** May `consent_log` keep `consent_id` and the event history after erasure, as Art. 7(1) evidence, once `user_id` is nulled? For how long?
- **L4.** Is the 365-day message retention ("12-month commission liability cap") a sound basis, and should a deletion request shorten it?
- **L5.** Retention period for security logs (`audit_log` IP and user agent, Tirreno), and the legitimate-interest balance for them.
- **L6.** Is sending a staff member's IP and sign-in city to every org owner proportionate, and does it need to be disclosed to staff?
- **L7.** The guest privacy policy excludes Chatwoot, Mistral and Upstash. If the guest widget is live (U10), that's an Art. 13 gap. Also: there is still no host-side privacy notice.
- **L8.** May ban data (`banned`, `banReason`) outlive an erasure request to prevent re-registration after fraud?
- **L9.** Server-side PostHog events with email were sent without consent. Is that a reportable incident, or just something to fix and purge?
- **L10.** Host photos that show people: once a host leaves, how quickly must the public originals and CDN caches be removed?
- **L11.** Neon point-in-time restore and branch snapshots keep deleted rows for the retention window. Is "deleted from production, aged out of backups within N days" acceptable, and what N should be stated?
