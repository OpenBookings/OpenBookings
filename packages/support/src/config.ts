/**
 * Chatwoot connection settings, read lazily so importing this package never
 * requires the env to be complete; each getter throws with the variable's
 * name the moment it is needed.
 *
 * Shared by apps/support-bot and apps/business. The names match the ones the
 * bot already used, so one set of values configures both.
 */

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} is not set`);
  return value.trim();
}

/** A boolean env flag: only "true" or "1" turn it on. */
export function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "true" || value === "1";
}

export const chatwootConfig = {
  /** Server-side base URL. Falls back to the public one the browser uses. */
  get baseUrl(): string {
    return required(
      "CHATWOOT_BASE_URL",
      process.env.CHATWOOT_BASE_URL || process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL,
    ).replace(/\/$/, "");
  },
  /**
   * Application API: Settings → Bots → your bot → Access token. Never a
   * person's token — the bot's messages must reach the host labelled as the
   * assistant.
   */
  get apiToken(): string {
    return required("CHATWOOT_BOT_ACCESS_TOKEN", process.env.CHATWOOT_BOT_ACCESS_TOKEN);
  },
  get accountId(): string {
    return required("CHATWOOT_ACCOUNT_ID", process.env.CHATWOOT_ACCOUNT_ID);
  },
  /**
   * Client API: the Business support inbox → Configuration → Inbox identifier
   * (the long text token, not the numeric id).
   */
  get inboxIdentifier(): string {
    return required(
      "CHATWOOT_BUSINESS_INBOX_IDENTIFIER",
      process.env.CHATWOOT_BUSINESS_INBOX_IDENTIFIER,
    );
  },
  /** That inbox → Configuration → Identity validation → HMAC token. Server-only. */
  get hmacToken(): string {
    return required(
      "CHATWOOT_BUSINESS_INBOX_HMAC_TOKEN",
      process.env.CHATWOOT_BUSINESS_INBOX_HMAC_TOKEN,
    );
  },
};

/** The two switches that gate host support. Both default to off. */
export const supportFlags = {
  /** The support panel, the /support ticket list and the support webhook. */
  get chatEnabled(): boolean {
    return envFlag("SUPPORT_CHAT_ENABLED");
  },
  /**
   * The AI assistant on host tickets: the bot answers, and the panel shows the
   * orb, "Talk to a person" and the answer check. Off means tickets go
   * straight to the support team.
   */
  get assistantEnabled(): boolean {
    return envFlag("SUPPORT_ASSISTANT_ENABLED");
  },
};
