/**
 * Env access for the support bot. Everything is read lazily so unit tests and
 * `bun run dev` don't need the full production set; each getter throws with
 * the variable's name the moment it's actually needed.
 *
 * DATABASE_URL and STRIPE_SECRET_KEY are consumed inside @openbookings/db and
 * @openbookings/stripe respectively — not read here.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Every variable the service needs to serve a request, including the two read
 * inside the workspace packages. Lazy getters alone would let a Cloud Run
 * revision start healthy and then 500 on every webhook — Chatwoot would retry
 * a request that can never succeed — so the entrypoint asserts the whole set
 * up front and the revision fails to go live instead.
 */
const REQUIRED_AT_STARTUP = [
  "MISTRAL_API_KEY",
  "CHATWOOT_BASE_URL",
  "CHATWOOT_API_TOKEN",
  "CHATWOOT_ACCOUNT_ID",
  "CHATWOOT_WEBHOOK_SECRET",
  "GOOGLE_CLOUD_PROJECT",
  "CLOUD_TASKS_QUEUE_NAME",
  "CLOUD_TASKS_QUEUE_LOCATION",
  "CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL",
  "SERVICE_BASE_URL",
  "DATABASE_URL", // read by @openbookings/db
  "STRIPE_SECRET_KEY", // read by @openbookings/stripe
] as const;

/** Throw listing *every* missing variable, not just the first one. */
export function assertRequiredEnv(): void {
  const missing = REQUIRED_AT_STARTUP.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `support-bot is missing required environment variables:\n  ${missing.join("\n  ")}`,
    );
  }

  // The local-dev escape hatches disable webhook-to-task authentication
  // entirely. Refuse to boot rather than let a stray value in a Cloud Run
  // revision leave /tasks/* open to anyone who can reach the service.
  if (process.env.NODE_ENV === "production") {
    const unsafe = (["TASKS_AUTH_DISABLED", "TASKS_INLINE"] as const).filter(
      (name) => process.env[name]?.trim() === "true",
    );
    if (unsafe.length > 0) {
      throw new Error(
        `${unsafe.join(" and ")} must not be set in production — these disable task authentication.`,
      );
    }
  }
}

export const env = {
  get mistralApiKey() {
    return required("MISTRAL_API_KEY");
  },
  get chatwootBaseUrl() {
    return required("CHATWOOT_BASE_URL").replace(/\/$/, "");
  },
  get chatwootApiToken() {
    return required("CHATWOOT_API_TOKEN");
  },
  get chatwootAccountId() {
    return required("CHATWOOT_ACCOUNT_ID");
  },
  get chatwootWebhookSecret() {
    return required("CHATWOOT_WEBHOOK_SECRET");
  },
  get cloudTasksProject() {
    // Set automatically on Cloud Run; explicit locally.
    return required("GOOGLE_CLOUD_PROJECT");
  },
  get cloudTasksQueueName() {
    return required("CLOUD_TASKS_QUEUE_NAME");
  },
  get cloudTasksQueueLocation() {
    return required("CLOUD_TASKS_QUEUE_LOCATION");
  },
  /** Public base URL of this service — Cloud Tasks posts back to it and it is the OIDC audience. */
  get serviceBaseUrl() {
    return required("SERVICE_BASE_URL").replace(/\/$/, "");
  },
  /** Service account Cloud Tasks uses to mint OIDC tokens for the task handler. */
  get tasksServiceAccountEmail() {
    return required("CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL");
  },
  /**
   * Local-dev escape hatch: dispatch straight to the task handler instead of
   * enqueueing, so the pipeline is testable without a Cloud Tasks queue.
   * Requires TASKS_AUTH_DISABLED too, or the self-call is rejected with 403.
   * Never set in production.
   */
  get tasksInline() {
    return process.env.TASKS_INLINE?.trim() === "true";
  },
  /** Local-dev escape hatch: skip OIDC verification on /tasks/*. Never set in production. */
  get tasksAuthDisabled() {
    // Trimmed: a stray trailing space in a .env file would otherwise make
    // this silently false, and the failure mode (auth unexpectedly ON in
    // local dev) looks like a broken queue rather than a typo.
    return process.env.TASKS_AUTH_DISABLED?.trim() === "true";
  },
  /**
   * Refunds at or above this amount (euros) force escalation to a human
   * before the model ever sees the request — real financial exposure is not
   * left to model judgment.
   */
  get refundEscalationThresholdEur() {
    return parseRefundThreshold(process.env.REFUND_ESCALATION_THRESHOLD_EUR);
  },
};

export const DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR = 250;

/**
 * An *empty* `REFUND_ESCALATION_THRESHOLD_EUR=` is not the same as an unset
 * one: `?? "250"` does not fire for `""`, and `Number("")` is 0 — which would
 * silently escalate every single payment lookup. Treat blank as unset, and
 * refuse anything that isn't a sane number rather than degrading to 0.
 */
export function parseRefundThreshold(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `REFUND_ESCALATION_THRESHOLD_EUR must be a non-negative number, got "${raw}"`,
    );
  }
  return parsed;
}
