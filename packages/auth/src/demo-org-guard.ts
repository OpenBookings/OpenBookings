import { DEMO_ORG_ID, DEMO_ORG_SLUG } from "@openbookings/mode";
import { APIError } from "better-auth";

const MESSAGE = "The demo organisation's members are managed by the system.";
const READ_MESSAGE = "The demo organisation's members are not listed.";

// In testing mode every host is an owner of the shared demo organisation, so
// no host may change who is in it or see who is: ensureDemoMembership and the
// reset write membership by SQL, never through these endpoints.
export function demoOrgError(): APIError {
  return new APIError("FORBIDDEN", { message: MESSAGE });
}

export function demoOrgReadError(): APIError {
  return new APIError("FORBIDDEN", { message: READ_MESSAGE });
}

export function refuseDemoOrg(organizationId: string | null | undefined): void {
  if (organizationId === DEMO_ORG_ID) throw demoOrgError();
}

const READ_PATHS = new Set([
  "/organization/list-members",
  "/organization/get-full-organization",
]);

function field(source: unknown, key: "organizationId" | "organizationSlug"): unknown {
  return source && typeof source === "object" ? (source as Record<string, unknown>)[key] : undefined;
}

export function isDemoOrgReadPath(path: string): boolean {
  return READ_PATHS.has(path);
}

/** True when the request names an organisation by id or slug. */
export function namesOrganization(query: unknown, body: unknown): boolean {
  return [query, body].some(
    (s) => Boolean(field(s, "organizationId")) || Boolean(field(s, "organizationSlug")),
  );
}

// `activeOrganizationId` is the session's, used by Better Auth when the request
// names no organisation; the caller resolves it only in that case.
export function demoOrgReadRefused(
  path: string,
  query: unknown,
  body: unknown,
  activeOrganizationId?: string | null,
): boolean {
  if (!READ_PATHS.has(path)) return false;
  if (
    field(query, "organizationId") === DEMO_ORG_ID ||
    field(body, "organizationId") === DEMO_ORG_ID ||
    field(query, "organizationSlug") === DEMO_ORG_SLUG ||
    field(body, "organizationSlug") === DEMO_ORG_SLUG
  ) {
    return true;
  }
  return !namesOrganization(query, body) && activeOrganizationId === DEMO_ORG_ID;
}
