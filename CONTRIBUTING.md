# Contributing to OpenBookings

Thanks for your interest in OpenBookings. This guide covers how to get the code running, how
changes get in, and the two legal steps every contribution needs.

## Ways to contribute

- **Report a bug** with the [bug report form](https://github.com/OpenBookings/OpenBookings/issues/new?template=bug_report.yml).
- **Suggest a feature** with the [feature request form](https://github.com/OpenBookings/OpenBookings/issues/new?template=feature_request.yml).
  For anything large, please open an issue before writing code, so we can agree on the approach first.
- **Improve the docs.** The documentation site lives in `apps/docs/content/docs`.
- **Fix something.** Issues labelled `good first issue` are a good place to start.

Security problems are the exception: please report them privately, as described in
[SECURITY.md](./SECURITY.md).

## Getting set up

You need Bun 1.3, Node.js 22.20 or newer, and Docker.

```bash
bun install
bun run testing:db      # local Postgres + PostGIS on port 5433
bun run testing:setup   # schema snapshot, migrations and seed data
```

Copy the `.env.example` files you need to `.env.local` (the root one, plus one per app you want to
run). The [local setup tutorial](./apps/docs/content/docs/self-hosted/tutorials/run-locally.mdx)
walks through it step by step, and [`testing/README.md`](./testing/README.md) lists the seeded
accounts and hotels.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Make your change. Keep it focused: one pull request per change.
3. Add or update tests. Unit tests sit next to the code as `*.test.ts`; tests that need a database
   are named `*.db.test.ts`.
4. Run the checks for what you touched:

   ```bash
   bun run lint
   bun run typecheck
   bun run test
   ```

5. Commit with a sign-off (see below) and open a pull request. The template asks for a short
   description and how you tested it.

### Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org) style, e.g.
  `fix(checkout): keep the selected rate after a date change`.
- **Money:** euros only. The older columns hold whole euros; newer `*_cents` columns hold cents.
  The column name tells you which one you're looking at. Rates are always tax-inclusive.
- **Database:** migrations in `packages/db/drizzle` are plain, idempotent SQL that is applied by
  hand. Never run `db:push` against a shared database. See [`packages/db/README.md`](./packages/db/README.md).
- **Authorization:** tenant isolation lives in `@openbookings/authz`. Don't write your own ownership
  checks in an endpoint.
- **Changelog:** user-visible changes get a line under `Unreleased` in [CHANGELOG.md](./CHANGELOG.md).

## Sign-off and CLA

Every contribution needs both of these. Each covers something different.

### 1. Developer Certificate of Origin (every commit)

The [DCO](./DCO) is your statement that you wrote the change, or otherwise have the right to submit
it. You make it by adding a `Signed-off-by` line to each commit, which `git` does for you:

```bash
git commit -s -m "fix(rates): reject a negative minimum stay"
```

That adds the following line, using your configured name and email:

```
Signed-off-by: Your Name <you@example.com>
```

A check on every pull request verifies the sign-off. If you forgot it, fix the branch and force-push:

```bash
git rebase --signoff main
git push --force-with-lease
```

### 2. Contributor License Agreement (once)

The [CLA](./CLA.md) gives the project the rights it needs to keep distributing your contribution,
including under a different license later. You keep the copyright to your work.

On your first pull request a bot posts a comment. Reply with the sentence it quotes to sign. You
only do this once, and it covers all your future contributions. If you contribute on behalf of
your employer, make sure you're allowed to. The CLA has a section on this.

## Review

The maintainer reviews pull requests, usually within a week. Expect questions. Once a pull request
is approved and its checks pass, it's squash-merged into `main`. How decisions are made is
described in [GOVERNANCE.md](./GOVERNANCE.md).

## Code of Conduct

Everyone taking part is expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
