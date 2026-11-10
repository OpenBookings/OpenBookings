# Changelog

All notable changes to OpenBookings are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until `1.0.0`, any minor release may
contain breaking changes, which are listed under **Changed** or **Removed**.

## [Unreleased]

### Added

- Open-source project files: contributing guide, code of conduct, security policy, governance,
  trademark policy, Contributor License Agreement and Developer Certificate of Origin.
- Issue forms, a pull-request template, and CLA and DCO checks on pull requests.
- Dependabot for dependency and security updates.
- `.env.example` files for the repository root and for each app.
- `testing/`: a local Postgres with PostGIS, a schema snapshot, and seed data with fixed IDs for
  trying the apps.
- `EMAIL_TRANSPORT=console`, which prints outgoing emails (sign-in links included) to the terminal
  instead of sending them, so the apps run locally without an email provider.
- Self-hosting documentation, organised as tutorials, how-to guides, reference and explanation.

### Changed

- **License:** OpenBookings is now licensed under the GNU Affero General Public License v3.0
  (`AGPL-3.0-only`), replacing the Mozilla Public License 2.0. Running a modified version as a
  service now means offering its source code to that service's users.

### Fixed

- Docs site: the animated hero stayed blank in development ("shader compile failed: null"),
  because its WebGL context was released while the canvas was still in use.

### Removed

- Renovate configuration (replaced by Dependabot).
- The internal design notes under `docs/` (still available in the git history).

## 0.1.0 (not tagged)

The state of OpenBookings before the open-source release:

- **Guest site:** search with a map, property pages, a multi-room checkout with Stripe, a guest
  account with saved rooms, and booking management with cancellation.
- **Host dashboard:** onboarding, property and room editors, photos, a rates-and-availability
  grid with restrictions, reservations, guest messaging, reviews and replies, team members and
  per-property access, analytics, and payouts through Stripe Connect.
- **Cancellation policy:** Flex (24 hours) and Standard (7 days) per property, non-refundable per
  rate plan, with the policy recorded on each reservation at booking time.
- **Billing:** a 4.5% commission, tax-inclusive rates with tourist tax, monthly commission
  invoices, and quarterly VAT, ICP and DAC7 reports.
- **Support:** the Chatwoot support assistant for guests and hosts.
- **Testing mode:** generated demo hotels that cover the booking flow's edge cases.

