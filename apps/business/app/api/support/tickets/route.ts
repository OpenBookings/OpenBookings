import type { LinkedKind } from "@/lib/support/categories";
import { formFiles, formString, readForm, supportRoute } from "@/lib/support/server/http";
import { createTicket } from "@/lib/support/server/service";

/** Open a support ticket: multipart, because the first message can carry files. */
export async function POST(request: Request) {
  return supportRoute({ key: "support-create", max: 10, windowMs: 60 * 60 * 1000 }, async (scope) => {
    const form = await readForm(request);
    const linkedType = formString(form, "linkedType");
    return createTicket(scope, {
      category: formString(form, "category") ?? "",
      linkedType: linkedType === "booking" || linkedType === "listing" ? (linkedType as LinkedKind) : null,
      linkedId: formString(form, "linkedId"),
      message: formString(form, "message") ?? "",
      followUpOf: formString(form, "followUpOf"),
      route: formString(form, "route"),
      replayUrl: formString(form, "replayUrl"),
      appVersion: process.env.NEXT_PUBLIC_RELEASE_SHA?.slice(0, 12) ?? null,
      files: formFiles(form),
    });
  });
}
