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
  /** Local-dev escape hatch: skip OIDC verification on /tasks/*. Never set in production. */
  get tasksAuthDisabled() {
    return process.env.TASKS_AUTH_DISABLED === "true";
  },
  /**
   * Refunds at or above this amount (euros) force escalation to a human
   * before the model ever sees the request — real financial exposure is not
   * left to model judgment.
   */
  get refundEscalationThresholdEur() {
    return Number(process.env.REFUND_ESCALATION_THRESHOLD_EUR ?? "250");
  },
};
