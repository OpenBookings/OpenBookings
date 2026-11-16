import { fromAddress, getEmailClient } from "@openbookings/mailing";
import { trackMail } from "@openbookings/mailing/tracking";
import type { InvoiceMailer } from "../steps/deliver";

/**
 * The real invoice mailer: Lettermint, from the usual OpenBookings sender,
 * with the PDF and CSV attached and the invoice id as idempotency key.
 */
export function lettermintInvoiceMailer(
  deps: { track?: typeof trackMail; getClient?: typeof getEmailClient } = {},
): InvoiceMailer {
  const track = deps.track ?? trackMail;
  const getClient = deps.getClient ?? getEmailClient;
  return async (m) => {
    // A test invoice goes to an internal address and is never tracked.
    const tracked = m.subject.startsWith("[TEST] ") ? null : await track({ kind: "commission_invoice", to: m.to, html: m.html });
    let message = getClient().from(fromAddress()).to(m.to).subject(m.subject).html(tracked?.html ?? m.html).text(m.text);
    for (const a of m.attachments) message = message.attach({ filename: a.filename, content: a.base64, contentType: a.contentType });
    const { message_id } = await message.send({ idempotencyKey: m.idempotencyKey });
    await tracked?.onSent();
    return { messageId: message_id };
  };
}
