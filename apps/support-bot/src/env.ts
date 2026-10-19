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
 * Every variable the service needs to serve a request, including the ones read
 * inside the workspace packages. Lazy getters alone would let a revision start
 * healthy and then 500 on every webhook — Chatwoot would retry a request that
 * can never succeed — so the entrypoint asserts the whole set up front and the
 * revision fails to go live instead.
 *
 * The set depends on the configuration: the task queue backend decides which
 * queue credentials are needed, and host support adds its own.
 */
const ALWAYS_REQUIRED = [
  "MISTRAL_API_KEY",
  "MISTRAL_MODEL",
  "CHATWOOT_BASE_URL",
  "CHATWOOT_ACCOUNT_ID",
  "SERVICE_BASE_URL",
  "DATABASE_URL", // read by @openbookings/db
  "STRIPE_SECRET_KEY", // read by @openbookings/stripe
] as const;

/**
 * The Agent Bot's credentials, each under its current name or the older one.
 * Reported by the current name when both are missing.
 */
const ALIASED: ReadonlyArray<readonly [current: string, older: string]> = [
  ["CHATWOOT_AGENT_ACCESS_TOKEN", "CHATWOOT_API_TOKEN"],
  ["CHATWOOT_AGENT_WH_TOKEN", "CHATWOOT_WEBHOOK_SECRET"],
];

function aliased(current: string, older: string): string | undefined {
  return process.env[current] || process.env[older] || undefined;
}

const QUEUE_REQUIRED: Record<TaskQueue, readonly string[]> = {
  "cloud-tasks": [
    "GOOGLE_CLOUD_PROJECT",
    "CLOUD_TASKS_QUEUE_NAME",
    "CLOUD_TASKS_QUEUE_LOCATION",
    "CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL",
  ],
  qstash: ["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"],
};

/** Needed only while host support is switched on (SUPPORT_CHAT_ENABLED). */
const SUPPORT_REQUIRED = [
  "CHATWOOT_BUSINESS_INBOX_ID",
  "CHATWOOT_SUPPORT_WEBHOOK_SECRET",
  "BUSINESS_APP_URL",
  "LETTERMINT_PROJECT_TOKEN", // read by @openbookings/mailing
] as const;

export type TaskQueue = "cloud-tasks" | "qstash";

/** TASK_QUEUE: "cloud-tasks" (default, the original setup) or "qstash". */
export function parseTaskQueue(raw: string | undefined): TaskQueue {
  const value = raw?.trim().toLowerCase();
  if (!value || value === "cloud-tasks") return "cloud-tasks";
  if (value === "qstash") return "qstash";
  throw new Error(`TASK_QUEUE must be "cloud-tasks" or "qstash", got "${raw}"`);
}

function flag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/** The variables this configuration needs. Exported for the startup check's tests. */
export function requiredAtStartup(): string[] {
  const names: string[] = [...ALWAYS_REQUIRED];
  for (const [current, older] of ALIASED) if (!aliased(current, older)) names.push(current);
  // Inline dispatch never touches a queue.
  if (!flag("TASKS_INLINE")) names.push(...QUEUE_REQUIRED[parseTaskQueue(process.env.TASK_QUEUE)]);
  if (flag("SUPPORT_CHAT_ENABLED")) names.push(...SUPPORT_REQUIRED);
  return names;
}

/** Throw listing *every* missing variable, not just the first one. */
export function assertRequiredEnv(): void {
  const missing = requiredAtStartup().filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `support-bot is missing required environment variables:\n  ${missing.join("\n  ")}`,
    );
  }

  // Parse the values whose format matters now, not on the first webhook.
  parseTaskQueue(process.env.TASK_QUEUE);
  if (flag("SUPPORT_CHAT_ENABLED")) void env.businessInboxId;

  // The local-dev escape hatches disable webhook-to-task authentication
  // entirely. Refuse to boot rather than let a stray value in a production
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
  /** Model for every assistant call, guest and host. */
  get mistralModel() {
    return required("MISTRAL_MODEL").trim();
  },
  get chatwootBaseUrl() {
    return required("CHATWOOT_BASE_URL").replace(/\/$/, "");
  },
  /** The Agent Bot's access token (CHATWOOT_API_TOKEN is the older name). */
  get chatwootApiToken() {
    const value = aliased("CHATWOOT_AGENT_ACCESS_TOKEN", "CHATWOOT_API_TOKEN");
    if (!value) throw new Error("CHATWOOT_AGENT_ACCESS_TOKEN is not set");
    return value;
  },
  get chatwootAccountId() {
    return required("CHATWOOT_ACCOUNT_ID");
  },
  /**
   * Secret Chatwoot signs the Agent Bot's webhook with (the bot's own
   * secret; CHATWOOT_WEBHOOK_SECRET is the older name).
   */
  get chatwootWebhookSecret() {
    const value = aliased("CHATWOOT_AGENT_WH_TOKEN", "CHATWOOT_WEBHOOK_SECRET");
    if (!value) throw new Error("CHATWOOT_AGENT_WH_TOKEN is not set");
    return value;
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
  get taskQueue(): TaskQueue {
    return parseTaskQueue(process.env.TASK_QUEUE);
  },
  get qstashToken() {
    return required("QSTASH_TOKEN");
  },
  /** QStash's publish endpoint; the EU region uses its own URL. */
  get qstashUrl() {
    return (process.env.QSTASH_URL?.trim() || "https://qstash.upstash.io").replace(/\/$/, "");
  },
  get qstashCurrentSigningKey() {
    return required("QSTASH_CURRENT_SIGNING_KEY");
  },
  get qstashNextSigningKey() {
    return required("QSTASH_NEXT_SIGNING_KEY");
  },
  /** Host support (the business app's tickets) is switched on. */
  get supportChatEnabled() {
    return flag("SUPPORT_CHAT_ENABLED");
  },
  /** The assistant answers host tickets. Off: host messages are left to people. */
  get supportAssistantEnabled() {
    return flag("SUPPORT_ASSISTANT_ENABLED");
  },
  /**
   * Numeric id of the Business support API inbox. Messages from it are host
   * tickets; everything else is guest support. Null when unset, so a
   * misconfiguration can only ever route a host message to "ignored", never
   * to the guest tools.
   */
  get businessInboxId(): number | null {
    const raw = process.env.CHATWOOT_BUSINESS_INBOX_ID?.trim();
    if (!raw) return null;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`CHATWOOT_BUSINESS_INBOX_ID must be a positive integer, got "${raw}"`);
    }
    return id;
  },
  /** Secret of the separate account webhook that keeps support_tickets current. */
  get supportWebhookSecret() {
    return required("CHATWOOT_SUPPORT_WEBHOOK_SECRET");
  },
  /** Public URL of apps/business, for links in reply emails. */
  get businessAppUrl() {
    return required("BUSINESS_APP_URL").replace(/\/$/, "");
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
