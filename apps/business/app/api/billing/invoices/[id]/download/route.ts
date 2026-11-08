import type { NextRequest } from "next/server";
import { createR2Store } from "@openbookings/billing/storage/r2";
import { getServerSession } from "@/lib/auth";
import { handleDownload } from "@/lib/billing/download";
import { findInvoiceFile } from "@/lib/billing/queries";
import { billingAccess } from "@/lib/billing/scope";

/**
 * Downloads one invoice file: a redirect to a five-minute signed link. The
 * invoice id comes from the URL, so it is only looked up inside the signed-in
 * member's own organization (see handleDownload).
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleDownload(
    {
      scope: async () => billingAccess(await getServerSession(), null), // handleDownload checks billing:read and answers 404
      find: findInvoiceFile,
      presign: (key, ttl, filename) => createR2Store(process.env).presign(key, ttl, filename),
    },
    id,
    request.nextUrl.searchParams.get("file"),
  );
}
