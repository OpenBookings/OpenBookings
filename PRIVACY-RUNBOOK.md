# Privacy runbook

Operational counterpart to `apps/web/app/privacy/page.tsx`. The policy is the promise;
this is how the promise gets kept.

## Erasure request (GDPR Art. 17)

Requests arrive by email at `privacy@openbookings.co`. §7 of the policy commits us to
30 days.

Since sign-in now calls `posthog.identify(user.id)`, a user's data lives in **two**
places keyed by the same UUID. Deleting only the database row leaves a PostHog person
whose distinct ID still resolves to a real human through our own backups — which is
not erasure.

1. Confirm the requester owns the account (reply to the address on the account, or ask
   them to send from it).
2. Note the user's UUID — you need it for step 3, and step 4 destroys it.
3. **PostHog first, while the lookup still works:**
   ```
   POSTHOG_PERSONAL_API_KEY=… POSTHOG_PROJECT_ID=… \
     bun scripts/delete-posthog-person.ts <user-uuid> --dry-run
   ```
   then re-run without `--dry-run`. "No PostHog person" is a normal outcome — it means
   they declined analytics cookies and were never identified.
4. Delete the database row, keeping whatever financial records the law requires (§7
   says "within the limits of what the law requires us to keep").
5. Reply confirming both halves are done.

Session recordings age out on their own after 30 days (§2.3), and `delete_events=true`
takes the rest, so there is no third place to clean.

## Material policy change

§10 promises two things happen together. Do both, or neither is true:

1. Bump the "Last updated" date in `apps/web/app/privacy/page.tsx`.
2. Bump `NEXT_PUBLIC_COOKIE_VERSION` so stored consent is invalidated and the banner
   comes back. It is a **GitHub Actions repository variable** (`vars.NEXT_PUBLIC_COOKIE_VERSION`,
   read in `.github/workflows/ci.yml`), baked in at image build time — changing it needs a
   rebuild, not just a redeploy. The `.env.local` copies only affect local dev.
