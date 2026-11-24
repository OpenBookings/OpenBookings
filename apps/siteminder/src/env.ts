/**
 * Env access for the SiteMinder app. Everything is read lazily so unit tests
 * and `bun run dev` don't need the full production set; each getter throws
 * with the variable's name the moment it's actually needed.
 *
 * This app has its own database (`SITEMINDER_DATABASE_URL`), separate from
 * the core one. It never reads DATABASE_URL at runtime; only the test harness
 * falls back to it (see testing/db-harness.ts).
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export type RunMode = "always-on" | "scale-to-zero";

const RUN_MODES: readonly RunMode[] = ["always-on", "scale-to-zero"];
const DEFAULT_POLL_SECONDS: Record<RunMode, number> = { "always-on": 60, "scale-to-zero": 300 };

function parseRunMode(raw: string | undefined): RunMode {
  const value = raw?.trim();
  if (!value) return "scale-to-zero";
  if (!(RUN_MODES as readonly string[]).includes(value)) {
    throw new Error(`SITEMINDER_RUN_MODE must be one of ${RUN_MODES.join(", ")}, got "${value}"`);
  }
  return value as RunMode;
}

/** Blank counts as unset; anything else must be a positive whole number. */
export function parsePollSeconds(raw: string | undefined, mode: RunMode): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_POLL_SECONDS[mode];
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`SITEMINDER_POLL_SECONDS must be a positive whole number, got "${raw}"`);
  }
  return parsed;
}

/** Every variable the service needs to serve a request. */
export function requiredAtStartup(): string[] {
  const names = [
    "SITEMINDER_DATABASE_URL",
    "SITEMINDER_INBOUND_USERNAME",
    "SITEMINDER_INBOUND_PASSWORD",
    "SITEMINDER_RESERVATION_URL",
    "SITEMINDER_RESERVATION_USERNAME",
    "SITEMINDER_RESERVATION_PASSWORD",
    "SITEMINDER_REQUESTOR_ID",
    "APP_SITEMINDER_REGISTRATION_SECRET",
    "SITEMINDER_TICK_SECRET",
    "SERVICE_BASE_URL",
  ];
  // Scale-to-zero has nothing running between requests: the queue wakes it.
  if (parseRunMode(process.env.SITEMINDER_RUN_MODE) === "scale-to-zero") {
    names.push("QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY");
  }
  return names;
}

/** Throw listing *every* missing variable, and reject malformed ones. */
export function assertRequiredEnv(): void {
  const mode = parseRunMode(process.env.SITEMINDER_RUN_MODE);
  parsePollSeconds(process.env.SITEMINDER_POLL_SECONDS, mode);
  const missing = requiredAtStartup().filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`siteminder is missing required environment variables:\n  ${missing.join("\n  ")}`);
  }
}

export const env = {
  get databaseUrl() {
    return required("SITEMINDER_DATABASE_URL");
  },
  /** Credentials SiteMinder presents to us (ours to hand out). */
  get soapUsername() {
    return required("SITEMINDER_INBOUND_USERNAME");
  },
  get soapPassword() {
    return required("SITEMINDER_INBOUND_PASSWORD");
  },
  /** SiteMinder's reservation endpoint and the credentials we present to it. */
  get reservationUrl() {
    return required("SITEMINDER_RESERVATION_URL");
  },
  get reservationUsername() {
    return required("SITEMINDER_RESERVATION_USERNAME");
  },
  get reservationPassword() {
    return required("SITEMINDER_RESERVATION_PASSWORD");
  },
  get requestorId() {
    return required("SITEMINDER_REQUESTOR_ID");
  },
  /** Shared secret core uses to register installations with this app. */
  get registrationSecret() {
    return required("APP_SITEMINDER_REGISTRATION_SECRET");
  },
  get tickSecret() {
    return required("SITEMINDER_TICK_SECRET");
  },
  get runMode(): RunMode {
    return parseRunMode(process.env.SITEMINDER_RUN_MODE);
  },
  get pollSeconds(): number {
    return parsePollSeconds(process.env.SITEMINDER_POLL_SECONDS, parseRunMode(process.env.SITEMINDER_RUN_MODE));
  },
  get qstashCurrentSigningKey() {
    return required("QSTASH_CURRENT_SIGNING_KEY");
  },
  get qstashNextSigningKey() {
    return required("QSTASH_NEXT_SIGNING_KEY");
  },
  /** Public base URL of this service; the queue's signature binds it. */
  get serviceBaseUrl() {
    return required("SERVICE_BASE_URL").replace(/\/$/, "");
  },
};
