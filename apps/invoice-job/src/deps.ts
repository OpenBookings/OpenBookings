import * as Sentry from "@sentry/bun";
import type { LedgerDeps } from "@openbookings/billing/ledger";
import { buildStripeLedgerDeps, stripeLedgerSource } from "@openbookings/billing/ledger/stripe-deps";
import type { RunReportDeps } from "@openbookings/billing/notify";
import { poolTransaction } from "@openbookings/billing/steps/reconcile";
import { normaliseVatId, type ViesDeps } from "@openbookings/billing/vies";
import { getPool, type Queryable } from "@openbookings/db";
import { fromAddress, getEmailClient } from "@openbookings/mailing";
import { stripe } from "@openbookings/stripe";

export type Env = Record<string, string | undefined>;

/** Reports to Sentry what the ledger reports (unexplained payments, amount mismatches), tagged like the platform webhook's. */
const report: LedgerDeps["report"] = (error, context) => {
  Sentry.captureException(error, { tags: { area: "commission-ledger" }, ...(context as Record<string, unknown> | undefined) });
};

/**
 * Writes the audit row for a payment the reconciliation returned, tied to the
 * organization that owns the account; one row per fact (`dedupeKey`). The
 * same statement as `apps/business/lib/stripe/audit.ts`.
 */
const audit =
  (db: Queryable): LedgerDeps["audit"] =>
  async ({ action, stripeAccountId, detail, dedupeKey }) => {
    await db.query(
      `INSERT INTO audit_log (action, organization_id, detail)
       SELECT $1, (SELECT organization_id FROM org_profile WHERE stripe_account_id = $2), $3::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM audit_log WHERE action = $1 AND detail->>'dedupeKey' = $4
       )`,
      [action, stripeAccountId, JSON.stringify({ ...detail, stripeAccountId, dedupeKey }), dedupeKey],
    );
  };

/** Posts `{ text }` to a Slack incoming webhook. */
function slackPoster(url: string): (text: string) => Promise<void> {
  return async (text) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error(`Slack webhook answered ${res.status}`);
  };
}

/**
 * Everything the steps need from the outside world, built from the
 * environment: the database pool (`DATABASE_URL`), Stripe
 * (`STRIPE_SECRET_KEY`), the ledger wired to both, Lettermint for the run
 * report (`LETTERMINT_PROJECT_TOKEN`, `INVOICE_REPORT_EMAIL`), Slack
 * (`SLACK_WEBHOOK_URL`, optional) and the VIES requester
 * (`VIES_REQUESTER_VAT`). Each part is read when a step asks for it, so a
 * step never needs another step's settings.
 */
export function jobDeps(env: Env) {
  const pool = getPool();
  const slack = env.SLACK_WEBHOOK_URL?.trim() ? slackPoster(env.SLACK_WEBHOOK_URL.trim()) : undefined;
  return {
    pool,
    /** Each unit of work in its own BEGIN/COMMIT on a pooled connection. */
    inTransaction: poolTransaction(pool),
    stripeSource: () => stripeLedgerSource(stripe),
    ledger: (): LedgerDeps => buildStripeLedgerDeps({ db: pool, stripe, report, audit: audit(pool) }),
    slack,

    /** OpenBookings' own VAT number as VIES's requester, so every check carries a request identifier. */
    viesDeps(): ViesDeps {
      const vat = env.VIES_REQUESTER_VAT?.trim();
      if (!vat) throw new Error("VIES_REQUESTER_VAT is required for the draft step");
      const { countryCode, vatNumber } = normaliseVatId(vat);
      if (countryCode !== "NL" || !vatNumber) throw new Error(`VIES_REQUESTER_VAT must be a Dutch VAT number (NL…), got "${vat}"`);
      return { requester: { countryCode, vatNumber } };
    },

    /** Where the run report goes: an email to `INVOICE_REPORT_EMAIL`, and Slack when configured. */
    runReport(): RunReportDeps {
      const to = env.INVOICE_REPORT_EMAIL?.trim();
      if (!to) throw new Error("INVOICE_REPORT_EMAIL is required to send the run report");
      // Built now, so a missing LETTERMINT_PROJECT_TOKEN stops the run before any work rather than after it.
      const client = getEmailClient();
      return {
        to,
        slack,
        mail: async (m) => {
          await client.from(fromAddress()).to(m.to).subject(m.subject).text(m.text).send();
        },
      };
    },
  };
}

export type JobDeps = ReturnType<typeof jobDeps>;
