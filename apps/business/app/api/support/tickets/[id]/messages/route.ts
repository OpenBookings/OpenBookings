import { formFiles, formString, readForm, supportRoute } from "@/lib/support/server/http";
import { sendMessage } from "@/lib/support/server/service";

/** Post a host message to a ticket: multipart, for attachments. */
export async function POST(request: Request, ctx: RouteContext<"/api/support/tickets/[id]/messages">) {
  const { id } = await ctx.params;
  return supportRoute({ key: "support-send", max: 30, windowMs: 60 * 1000 }, async (scope) => {
    const form = await readForm(request);
    return sendMessage(scope, id, { content: formString(form, "content") ?? "", files: formFiles(form) });
  });
}
