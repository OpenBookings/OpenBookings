# OpenBookings

## What we say must match what the code does

Hosts and guests rely on what the docs, the legal texts and the site tell them.
When a change alters a rule about money, cancellation, guests or personal data,
the words that describe that rule change in the same pull request.

A change touches such a rule when it changes, for example:

- the commission rate, what it is charged on, or when it comes back on a refund;
- cancellation tiers, their free-cancellation windows, no-show or early-departure refunds;
- the Non-refundable rules, such as the price gap to a refundable rate;
- tourist tax, VAT, cots and extra beds, or the guest age bands;
- reviews (when they open and close), invoices, payouts;
- what personal data is kept, for how long, and which vendors receive it.

Then check, and update where they no longer hold:

- the help docs: `apps/docs/content/docs`;
- the guest legal texts: `apps/web/content/legal` (Terms, Privacy Policy). Never edit a
  published version: add a new dated version and register it;
- the Host Agreement: `apps/business/content/legal/host-agreement`. Same rule: a new version;
- the copy on the sites: the home pages, FAQs, calculators, checkout and email text;
- the test data and its description: `testing/seed`, `apps/docs/content/docs/self-hosted/reference/test-data.mdx`.

Put each number such a rule depends on in one named constant (in `@openbookings/pricing`,
`@openbookings/stripe/commission-rate` and so on) and have code and UI copy import it
instead of typing the number again. Legal texts and docs state the number literally, so
tests check them against the constant:

- `apps/docs/lib/claims.test.ts`: the help docs;
- `apps/web/lib/legal/terms.test.ts` and `documents.test.ts`: the Terms and Privacy Policy;
- `apps/business/lib/legal/host-agreement.test.ts`: the Host Agreement.

When you add a rule or a statement of one, add it to these tests. When one of them fails
after a code change, update the text (with a new legal version where needed), not the test.

Reviewers: flag a pull request that changes such a rule without the matching text change.
