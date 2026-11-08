import { fromAddress, getEmailClient } from "@openbookings/mailing";
import type { InvoiceMailer } from "../steps/deliver";

/**
 * The real invoice mailer: Lettermint, from the usual OpenBookings sender,
 * with the PDF and CSV attached and the invoice id as idempotency key.
 */
export function lettermintInvoiceMailer(): InvoiceMailer {
  return async (m) => {
    let message = getEmailClient().from(fromAddress()).to(m.to).subject(m.subject).html(m.html).text(m.text);
    for (const a of m.attachments) message = message.attach(a.filename, a.base64, undefined, a.contentType);
    const { message_id } = await message.idempotencyKey(m.idempotencyKey).send();
    return { messageId: message_id };
  };
}
