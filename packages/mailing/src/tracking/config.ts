import { isTestingMode } from "@openbookings/demo";

export type TrackingConfig = {
  key: Buffer;
  /** Public web origin, no trailing slash: tracking URLs are `${baseUrl}/e/o/…` and `/e/c/…`. */
  baseUrl: string;
  /** `URL.host` values (host incl. port) whose links are rewritten and may be redirected to. */
  ownHosts: string[];
  consentVersion: number;
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** null (tracking off, emails byte-identical) unless every switch-on condition holds. */
export function trackingConfig(
  env: Record<string, string | undefined> = process.env,
  testing: boolean = isTestingMode(),
): TrackingConfig | null {
  if (testing) return null;
  if (env.EMAIL_TRACKING_ENABLED?.trim() !== "true") return null;
  if (env.EMAIL_TRANSPORT?.trim() === "console") return null;
  if (!env.NEXT_PUBLIC_POSTHOG_KEY || !env.NEXT_PUBLIC_POSTHOG_HOST) return null;

  const secret = env.EMAIL_TRACKING_SECRET?.trim();
  if (!secret) return null;
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) return null;

  const version = env.EMAIL_TRACKING_CONSENT_VERSION?.trim();
  if (!version || !/^\d+$/.test(version)) return null;

  const webUrl = env.NEXT_PUBLIC_WEB_URL || "https://openbookings.co";
  const businessUrl = env.NEXT_PUBLIC_BUSINESS_URL || "https://business.openbookings.co";
  const webHost = hostOf(webUrl);
  const businessHost = hostOf(businessUrl);
  if (!webHost || !businessHost) return null;

  return {
    key,
    baseUrl: webUrl.replace(/\/+$/, ""),
    ownHosts: [webHost, businessHost],
    consentVersion: Number(version),
  };
}
