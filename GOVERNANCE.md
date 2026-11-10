# Governance

This document describes how OpenBookings is run: who decides what, and how that can change.

## Model

OpenBookings uses a **single-maintainer model** for now. The project was started by, and is
maintained by, Wouter van der Wal (the *maintainer*). Being open source doesn't make it
a democracy. It means the decisions and the reasons for them are made in public.

The maintainer:

- sets the roadmap and the scope of the project,
- reviews and merges pull requests,
- cuts releases and keeps the changelog,
- handles security reports and Code of Conduct reports, and
- owns the OpenBookings name and branding (see [TRADEMARKS.md](./TRADEMARKS.md)).

## How decisions are made

- **Day-to-day changes** (bug fixes, small features, docs) are decided in the pull request.
- **Larger changes** (new modules, schema changes, new external services, anything that changes
  how hosts or guests are charged) start as an issue that describes the problem and the proposed
  approach. Code follows once there's agreement.
- **Disagreements** are worked out in the issue or pull request. If no consensus is reached, the
  maintainer decides and writes down why.

## Scope

OpenBookings is a booking engine and marketplace for professionally run hotels in the EU. A few
choices are fixed, and changes that undo them are unlikely to be accepted:

- **EU only, EUR only.** No other currencies and no properties outside the EU.
- **Prepayment on the platform.** Every booking is paid online through the platform. No pay-at-the-property option.
- **Rates include tax.** Guests always see the full price.

## Open core

The core of OpenBookings is free to use and self-host, and it stays that way. In the future, some
advanced features for large organisations (such as single sign-on, audit logs and advanced
analytics) may be offered under a separate commercial license. If that happens, those features
will live in clearly marked directories, and nothing that is open source today will move under
the commercial license.

## Becoming a maintainer

As the project grows, regular contributors who have shown good judgement over a sustained period
may be invited to become maintainers, with review and merge rights. When there is more than one
maintainer, this document will be updated to describe how they make decisions together.

## Changes to this document

Changes to governance are made by pull request and are approved by the maintainer.
