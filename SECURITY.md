# Security Policy

OpenBookings handles payments, personal data and the bookings of real guests, so security reports
get priority over everything else.

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a security problem.**

Report it privately in one of these ways:

1. **Preferred:** GitHub's private vulnerability reporting. Open the repository's
   [Security tab](https://github.com/OpenBookings/OpenBookings/security) and choose
   **Report a vulnerability**.
2. **Email:** support@openbookings.co with `SECURITY` at the start of the subject line.

Please include:

- what the problem is and what an attacker could do with it,
- the steps, a request, or a proof of concept that reproduces it,
- the affected app (`web`, `business`, `support-bot`, …), version or commit, and
- whether you think it's being exploited right now.

## What to expect

| When | What |
| --- | --- |
| Within 3 working days | We confirm we received your report. |
| Within 10 working days | We tell you whether we can reproduce it and how serious we think it is. |
| When it's fixed | We let you know before the fix is public and agree on a disclosure date with you. |

We ask you to give us up to 90 days to fix a problem before you disclose it publicly. With your
permission, we credit you in the advisory.

## Scope

In scope:

- the code in this repository, and
- the hosted service at `openbookings.co` and its subdomains.

Out of scope:

- findings that need a compromised device or account, or physical access,
- denial-of-service through sheer volume, social engineering, and spam,
- missing hardening headers or best practices without a demonstrated impact, and
- problems in third-party services (Stripe, Neon, Cloudflare, …). Report those to the vendor.

## Testing safely

- Only use accounts and data that belong to you. Self-host a copy, or run it locally with the
  seed data in `testing/`.
- Never access, change or delete other people's data, and stop as soon as you reach any.
- Never test against live payments. Use Stripe test mode.

If you follow this policy in good faith, we will not take legal action against you over your
research.

## Supported versions

OpenBookings is pre-release. Only the latest `main` gets security fixes.
