import { isTestingMode } from "@openbookings/demo";

type Env = Record<string, string | undefined>;

/** What opening and redirecting a click token needs: no PostHog, no consent version, no on-switch. */
export type ClickRedirectConfig = {
  key: Buffer;
  /** Public web origin, no trailing slash: tracking URLs are `${baseUrl}/e/o/…` and `/e/c/…`. */
  baseUrl: string;
  /** `URL.host` values (host incl. port) whose links are rewritten and may be redirected to. */
  ownHosts: string[];
};

export type TrackingConfig = ClickRedirectConfig & {
  consentVersion: number;
};

/**
 * `process.env` plus a literal reference to each `NEXT_PUBLIC_*` variable, so Next inlines their
 * build-time values: the production Docker stage does not have them at runtime.
 */
function defaultEnv(): Env {
  return {
    ...process.env,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
    NEXT_PUBLIC_BUSINESS_URL: process.env.NEXT_PUBLIC_BUSINESS_URL,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Needs only `EMAIL_TRACKING_SECRET` and both app URLs (no production fallback), so links in mail
 * already sent keep working when tracking is switched off or half-configured.
 */
export function clickRedirectConfig(env: Env = defaultEnv()): ClickRedirectConfig | null {
  const secret = env.EMAIL_TRACKING_SECRET?.trim();
  if (!secret) return null;
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) return null;

  const webUrl = env.NEXT_PUBLIC_WEB_URL?.trim();
  const businessUrl = env.NEXT_PUBLIC_BUSINESS_URL?.trim();
  if (!webUrl || !businessUrl) return null;
  const webHost = hostOf(webUrl);
  const businessHost = hostOf(businessUrl);
  if (!webHost || !businessHost) return null;

  return { key, baseUrl: webUrl.replace(/\/+$/, ""), ownHosts: [webHost, businessHost] };
}

/** null (tracking off, emails byte-identical) unless every switch-on condition holds. */
export function trackingConfig(env: Env = defaultEnv(), testing: boolean = isTestingMode()): TrackingConfig | null {
  if (testing) return null;
  if (env.EMAIL_TRACKING_ENABLED?.trim() !== "true") return null;
  if (env.EMAIL_TRANSPORT?.trim() === "console") return null;
  if (!env.NEXT_PUBLIC_POSTHOG_KEY || !env.NEXT_PUBLIC_POSTHOG_HOST) return null;

  const version = env.EMAIL_TRACKING_CONSENT_VERSION?.trim();
  if (!version || !/^\d+$/.test(version)) return null;

  const redirect = clickRedirectConfig(env);
  if (!redirect) return null;
  return { ...redirect, consentVersion: Number(version) };
}
