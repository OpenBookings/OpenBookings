import { beforeAll, describe, expect, test } from "bun:test";
import type { trackMail } from "@openbookings/mailing/tracking";
import { renderSupportReplyEmail, sendSupportReplyNotification } from "./notify";

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

beforeAll(() => {
  process.env.BUSINESS_APP_URL = "https://business.example";
});

const payload = { conversationId: 7, messageAt: "2026-11-15T10:00:00Z" } as Parameters<typeof sendSupportReplyNotification>[0];
const claim = async () => ({ ticket_id: "t-1", conversation_id: 7, email: "host@hotel.nl", name: "Olga Owner" }) as any;

describe("sendSupportReplyNotification tracking", () => {
  test("sends the tracked html as support_reply, text unchanged, onSent after send()", async () => {
    const log: string[] = [];
    const sent: Sent[] = [];
    await sendSupportReplyNotification(payload, { track: tracker(log), claim, getClient: fakeClient(log, sent) });
    const plain = renderSupportReplyEmail({ name: "Olga Owner", reference: 7, url: "https://business.example/support?ticket=t-1" });
    expect(sent[0].html!.endsWith("<!--support_reply:host@hotel.nl-->")).toBe(true);
    expect(sent[0].text).toBe(plain.text);
    expect(log).toEqual(["send", "onSent"]);
  });

  test("a failing send is swallowed as before and not marked sent", async () => {
    const log: string[] = [];
    const orig = console.error;
    console.error = () => {};
    try {
      await sendSupportReplyNotification(payload, {
        track: tracker(log),
        claim,
        getClient: fakeClient(log, [], new Error("smtp down")),
      });
    } finally {
      console.error = orig;
    }
    expect(log).toEqual([]);
  });

  test("nothing claimed sends and tracks nothing", async () => {
    const log: string[] = [];
    await sendSupportReplyNotification(payload, { track: tracker(log), claim: async () => null, getClient: fakeClient(log, []) });
    expect(log).toEqual([]);
  });
});
