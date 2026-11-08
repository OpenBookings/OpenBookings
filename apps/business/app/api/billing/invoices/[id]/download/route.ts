import type { NextRequest } from "next/server";
import { getOrgScopedDb } from "@openbookings/authz";
import { createR2Store } from "@openbookings/billing/storage/r2";
import { getServerSession } from "@/lib/auth";
import { handleDownload } from "@/lib/billing/download";
import { billingScope, findInvoiceFile } from "@/lib/billing/queries";

/**
 * Downloads one invoice file: a redirect to a five-minute signed link. The
 * invoice id comes from the URL, so it is only looked up inside the signed-in
 * member's own organization (see handleDownload).
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleDownload(
    {
      scope: async () => {
        const session = await getServerSession();
        const scoped = await getOrgScopedDb(session);
        return scoped ? { ...billingScope(scoped), memberRole: scoped.memberRole } : null;
      },
      find: findInvoiceFile,
      presign: (key, ttl, filename) => createR2Store(process.env).presign(key, ttl, filename),
    },
    id,
    request.nextUrl.searchParams.get("file"),
  );
}
