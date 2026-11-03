/**
 * Env access for the support bot. Everything is read lazily so unit tests and
 * `bun run dev` don't need the full production set; each getter throws with
 * the variable's name the moment it's actually needed.
 *
 * DATABASE_URL and STRIPE_SECRET_KEY are consumed inside @openbookings/db and
 * @openbookings/stripe respectively — not read here.
 */

import { parseInboxIds } from "./chatwoot/identity";

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
 * The set depends on the configuration: inline dispatch (local dev) needs no
 * queue credentials, and host support adds its own.
 */
const ALWAYS_REQUIRED = [
  "MISTRAL_API_KEY",
  "MISTRAL_MODEL",
  "CHATWOOT_BASE_URL",
  "CHATWOOT_ACCOUNT_ID",
  "CHATWOOT_BOT_ACCESS_TOKEN",
  "CHATWOOT_BOT_WEBHOOK_SECRET",
  "SERVICE_BASE_URL",
  "DATABASE_URL", // read by @openbookings/db
  "STRIPE_SECRET_KEY", // read by @openbookings/stripe
] as const;

const QUEUE_REQUIRED = ["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"] as const;

/** Needed only while host support is switched on (SUPPORT_CHAT_ENABLED). */
const SUPPORT_REQUIRED = [
  "CHATWOOT_BUSINESS_INBOX_ID",
  "CHATWOOT_ACCOUNT_WEBHOOK_SECRET",
  "BUSINESS_APP_URL",
  "LETTERMINT_PROJECT_TOKEN", // read by @openbookings/mailing
] as const;

function tasksAuthDisabledFlag(): boolean {
  return process.env.TASKS_AUTH_DISABLED?.trim() === "true";
}

/**
 * Whether `value` is an http(s) URL on the loopback interface or a
 * *.localhost name (RFC 6761: never resolves off the machine).
 */
export function isLocalBaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const { hostname } = new URL(value);
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function flag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/** The variables this configuration needs. Exported for the startup check's tests. */
export function requiredAtStartup(): string[] {
  const names: string[] = [...ALWAYS_REQUIRED];
  // Inline dispatch never touches a queue.
  if (!flag("TASKS_INLINE")) names.push(...QUEUE_REQUIRED);
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
  if (flag("SUPPORT_CHAT_ENABLED")) void env.businessInboxId;
  void env.verifiedGuestInboxIds;

  // The local-dev escape hatches disable webhook-to-task authentication
  // entirely. Refuse to boot rather than let a stray value in a production
  // revision leave /tasks/* open to anyone who can reach the service.
  if (tasksAuthDisabledFlag() && !isLocalBaseUrl(process.env.SERVICE_BASE_URL)) {
    throw new Error(
      "TASKS_AUTH_DISABLED is set but SERVICE_BASE_URL is not a localhost address — refusing to start with task authentication off.",
    );
  }
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
  /** Settings → Bots → your bot → Access token. */
  get chatwootApiToken() {
    return required("CHATWOOT_BOT_ACCESS_TOKEN");
  },
  get chatwootAccountId() {
    return required("CHATWOOT_ACCOUNT_ID");
  },
  /**
   * Settings → Bots → your bot → Webhook secret. Chatwoot signs the bot's
   * outgoing webhook (/webhooks/chatwoot) with it.
   */
  get chatwootWebhookSecret() {
    return required("CHATWOOT_BOT_WEBHOOK_SECRET");
  },
  /**
   * Public base URL of this service. QStash posts back to it, and the
   * delivery signature binds this URL, so it must match exactly.
   */
  get serviceBaseUrl() {
    return required("SERVICE_BASE_URL").replace(/\/$/, "");
  },
  /**
   * Local-dev escape hatch: dispatch straight to the task handler instead of
   * enqueueing, so the pipeline is testable without a QStash account.
   * Requires TASKS_AUTH_DISABLED too, or the self-call is rejected with 403.
   * Never set in production.
   */
  get tasksInline() {
    return process.env.TASKS_INLINE?.trim() === "true";
  },
  /**
   * Local-dev escape hatch: skip signature verification on /tasks/*.
   *
   * Honoured only when this service's own base URL is a loopback address (see
   * isLocalBaseUrl) and NODE_ENV is not production. The flag alone is not
   * enough: a deployed revision has a public SERVICE_BASE_URL, so a stray
   * TASKS_AUTH_DISABLED=true there stays inert instead of leaving /tasks/*
   * open, whatever NODE_ENV the platform happens to set. assertRequiredEnv
   * goes further and refuses to boot with the flag set anywhere it would not
   * be honoured.
   */
  get tasksAuthDisabled() {
    // Trimmed: a stray trailing space in a .env file would otherwise make
    // this silently false, and the failure mode (auth unexpectedly ON in
    // local dev) looks like a broken queue rather than a typo.
    return (
      tasksAuthDisabledFlag() &&
      process.env.NODE_ENV !== "production" &&
      isLocalBaseUrl(process.env.SERVICE_BASE_URL)
    );
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
  /**
   * Chatwoot inbox ids (comma-separated) where "Enforce user identity
   * validation" (HMAC) is turned on, so a contact's email there was set by a
   * signed call from our server and not typed by the visitor. Only those
   * inboxes let the bot list a guest's bookings by email. Empty (the default)
   * means no inbox is trusted: bookings can then only be reached with an
   * explicit booking reference. See chatwoot/identity.ts.
   */
  get verifiedGuestInboxIds(): number[] {
    return parseInboxIds(process.env.CHATWOOT_VERIFIED_INBOX_IDS, "CHATWOOT_VERIFIED_INBOX_IDS");
  },
  /**
   * Settings → Integrations → Webhooks → the /webhooks/business-support entry.
   * Keeps support_tickets current.
   */
  get supportWebhookSecret() {
    return required("CHATWOOT_ACCOUNT_WEBHOOK_SECRET");
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
