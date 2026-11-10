## What this changes

<!-- What does this pull request do, and why? Link the issue it closes, if there is one: "Closes #123". -->

## How it was tested

<!-- Tests you added or ran, and any manual checks (e.g. "booked the seeded Grachtenhuis Double, cancelled it as the guest"). -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`). See [DCO](https://github.com/OpenBookings/OpenBookings/blob/main/DCO).
- [ ] I have signed the [CLA](https://github.com/OpenBookings/OpenBookings/blob/main/CLA.md), or will when the bot asks.
- [ ] `bun run lint`, `bun run typecheck` and `bun run test` pass for what I touched.
- [ ] A new migration in `packages/db/drizzle` is idempotent, and is listed in `packages/db/src/testing/pending-migrations.ts`.
- [ ] New environment variables are added to the matching `.env.example` and the self-hosting reference.
- [ ] User-visible changes have a line under `Unreleased` in `CHANGELOG.md`.
- [ ] No secrets, real guest data or real booking data in the code, tests or screenshots.
