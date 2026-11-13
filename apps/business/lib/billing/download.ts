import { roleAllows } from "@openbookings/authz/permissions";
import type { BillingScope, InvoiceFile } from "./queries";

/** How long a download link works. */
const DOWNLOAD_LINK_SECONDS = 300;

export type DownloadDeps = {
  /** The signed-in member's organization and role, or `null` when there is no valid session or membership. */
  scope(): Promise<(BillingScope & { memberRole: string }) | null>;
  find(scope: BillingScope, invoiceId: string, file: InvoiceFile): Promise<{ key: string; filename: string } | null>;
  presign(key: string, ttlSeconds: number, filename: string): Promise<string>;
};

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * The download route's decision, on every request: a signed-in member whose
 * role holds `billing:read`, and an invoice that belongs to their own
 * organization and has the file stored, get a redirect to a short-lived signed
 * link. Everything else (no such invoice, another organization's, no file yet,
 * a role without billing access) is the same 404, so the answer never reveals
 * that an invoice exists.
 */
export async function handleDownload(deps: DownloadDeps, invoiceId: string, fileParam: string | null): Promise<Response> {
  const scope = await deps.scope();
  if (!scope) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!roleAllows(scope.memberRole, { billing: ["read"] }, false)) return notFound();
  if (fileParam !== "pdf" && fileParam !== "csv") return notFound();

  const found = await deps.find(scope, invoiceId, fileParam);
  if (!found) return notFound();

  const url = await deps.presign(found.key, DOWNLOAD_LINK_SECONDS, found.filename);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}
