import { z } from "zod";

/**
 * Auth-critical environment, validated at boot. Required vars throw — no
 * defaults. A silent default on AUTH_COOKIE_PREFIX would collapse the
 * host/guest cookie boundary in production, so the prefix is an enum, not a
 * free string.
 *
 * `next build` runs these modules without runtime secrets (Docker build args
 * are NEXT_PUBLIC_* only), so validation is skipped during the build phase
 * and the placeholder values below are never used to serve a request: the
 * same module re-executes with real env when the server boots.
 */
const schema = z.object({
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  AUTH_COOKIE_PREFIX: z.enum(["ob-guest", "ob-host"]),
  AUTH_BASE_URL: z.url(),
});

export type AuthEnv = z.infer<typeof schema>;

const BUILD_PHASE_PLACEHOLDER: AuthEnv = {
  BETTER_AUTH_SECRET: "build-phase-placeholder-secret-not-a-secret",
  AUTH_COOKIE_PREFIX: "ob-guest",
  AUTH_BASE_URL: "http://build-phase.invalid",
};

export function readAuthEnv(): AuthEnv {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return BUILD_PHASE_PLACEHOLDER;
  }

  const parsed = schema.safeParse({
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    AUTH_COOKIE_PREFIX: process.env.AUTH_COOKIE_PREFIX,
    // AUTH_BASE_URL is the canonical name; BETTER_AUTH_URL is accepted as a
    // legacy alias so existing deploy config keeps working during rollout.
    AUTH_BASE_URL: process.env.AUTH_BASE_URL ?? process.env.BETTER_AUTH_URL,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid auth environment: ${issues}`);
  }

  return parsed.data;
}
