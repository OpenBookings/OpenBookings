import { DEMO_ORG_ID } from "@openbookings/mode";
import { APIError } from "better-auth";

const MESSAGE = "The demo organisation's members are managed by the system.";

// In testing mode every host is an owner of the shared demo organisation, so
// no host may change who is in it or see who is: ensureDemoMembership and the
// reset write membership by SQL, never through these endpoints.
export function demoOrgError(): APIError {
  return new APIError("FORBIDDEN", { message: MESSAGE });
}

export function refuseDemoOrg(organizationId: string | null | undefined): void {
  if (organizationId === DEMO_ORG_ID) throw demoOrgError();
}

const READ_PATHS = new Set([
  "/organization/list-members",
  "/organization/get-full-organization",
]);

function organizationIdOf(source: unknown): unknown {
  return source && typeof source === "object"
    ? (source as { organizationId?: unknown }).organizationId
    : undefined;
}

export function demoOrgReadRefused(path: string, query: unknown, body: unknown): boolean {
  if (!READ_PATHS.has(path)) return false;
  return organizationIdOf(query) === DEMO_ORG_ID || organizationIdOf(body) === DEMO_ORG_ID;
}
