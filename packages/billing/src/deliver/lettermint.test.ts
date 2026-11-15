import { describe, expect, test } from "bun:test";
import type { trackMail } from "@openbookings/mailing/tracking";
import type { InvoiceMail } from "../steps/deliver";
import { lettermintInvoiceMailer } from "./lettermint";

type Sent = { to?: string; html?: string; text?: string; subject?: string; opts?: unknown };
function fakeClient(log: string[], sent: Sent[], failWith?: Error) {
  const make = (state: Sent): any => ({
    from: () => make(state),
    to: (to: string) => make({ ...state, to }),
    subject: (subject: string) => make({ ...state, subject }),
    html: (html: string) => make({ ...state, html }),
    text: (text: string) => make({ ...state, text }),
    attach: () => make(state),
    send: async (opts?: unknown) => {
      if (failWith) throw failWith;
      sent.push({ ...state, opts });
      log.push("send");
      return { message_id: "m1" };
    },
  });
  return () => make({});
}
const tracker = (log: string[]): typeof trackMail => async ({ kind, to, html }) => ({
  html: `${html}<!--${kind}:${to}-->`,
  onSent: async () => {
    log.push("onSent");
  },
});

const mail: InvoiceMail = {
  to: "billing@hotel.nl",
  subject: "Invoice OB-1",
  html: "<p>Invoice</p>",
  text: "Invoice",
  attachments: [{ filename: "a.pdf", base64: "AA==", contentType: "application/pdf" }],
  idempotencyKey: "inv-1",
};

describe("lettermintInvoiceMailer tracking", () => {
  test("sends the tracked html as commission_invoice, text unchanged, onSent after send()", async () => {
    const log: string[] = [];
    const sent: Sent[] = [];
    const res = await lettermintInvoiceMailer({ track: tracker(log), getClient: fakeClient(log, sent) })(mail);
    expect(res).toEqual({ messageId: "m1" });
    expect(sent[0].html).toBe("<p>Invoice</p><!--commission_invoice:billing@hotel.nl-->");
    expect(sent[0].text).toBe("Invoice");
    expect(sent[0].opts).toEqual({ idempotencyKey: "inv-1" });
    expect(log).toEqual(["send", "onSent"]);
  });

  test("a [TEST] invoice skips track and sends its html untouched", async () => {
    const log: string[] = [];
    const sent: Sent[] = [];
    const track: typeof trackMail = async () => {
      log.push("track");
      throw new Error("must not be called");
    };
    await lettermintInvoiceMailer({ track, getClient: fakeClient(log, sent) })({ ...mail, subject: "[TEST] Invoice OB-1" });
    expect(sent[0].html).toBe("<p>Invoice</p>");
    expect(log).toEqual(["send"]);
  });

  test("a failing send is not marked sent and the error propagates", async () => {
    const log: string[] = [];
    await expect(
      lettermintInvoiceMailer({ track: tracker(log), getClient: fakeClient(log, [], new Error("down")) })(mail),
    ).rejects.toThrow("down");
    expect(log).toEqual([]);
  });
});
