import { describe, expect, test } from "bun:test";
import type { getEmailClient } from "@openbookings/mailing";
import type { trackMail } from "@openbookings/mailing/tracking";
import { invitationUrl, renderInvitation, sendInvitationEmail } from "./invitation";

const invite = {
  invitationId: "abc 123",
  email: "new@hotel.nl",
  role: "frontdesk",
  organizationName: "Hotel <script>",
  inviterName: 'Olga "O" Owner',
  expiresAt: new Date("2026-11-10T12:00:00Z"),
};


type Sent = { to?: string; html?: string; text?: string; subject?: string; opts?: unknown };
type FakeBuilder = {
  from: () => FakeBuilder;
  to: (to: string) => FakeBuilder;
  subject: (subject: string) => FakeBuilder;
  html: (html: string) => FakeBuilder;
  text: (text: string) => FakeBuilder;
  attach: () => FakeBuilder;
  send: (opts?: unknown) => Promise<{ message_id: string }>;
};
function fakeClient(log: string[], sent: Sent[], failWith?: Error): typeof getEmailClient {
  const make = (state: Sent): FakeBuilder => ({
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
  return () => make({}) as unknown as ReturnType<typeof getEmailClient>;
}
const tracker = (log: string[]): typeof trackMail => async ({ kind, to, html }) => ({
  html: `${html}<!--${kind}:${to}-->`,
  onSent: async () => {
    log.push("onSent");
  },
});

describe("renderInvitation", () => {
  test("names the organisation and the role by its label", () => {
    const { subject, html } = renderInvitation(invite, "https://business.example");
    expect(subject).toContain("Hotel <script>");
    expect(html).toContain("Front desk");
    expect(html).toContain("10 November");
  });

  test("escapes names that came from people", () => {
    const { html } = renderInvitation(invite, "https://business.example");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Hotel &lt;script&gt;");
    expect(html).toContain("Olga &quot;O&quot; Owner");
  });

  test("leaves no template placeholder unfilled", () => {
    expect(renderInvitation(invite, "https://business.example").html).not.toContain("{{");
  });

  test("links to the invite page on our own origin", () => {
    expect(invitationUrl("abc 123", "https://business.example")).toBe("https://business.example/invite/abc%20123");
    expect(renderInvitation(invite, "https://business.example").html).toContain(
      "https://business.example/invite/abc%20123",
    );
  });
});

describe("sendInvitationEmail tracking", () => {
  test("sends the tracked html as a team_invitation and marks it sent after send()", async () => {
    const log: string[] = [];
    const sent: Sent[] = [];
    await sendInvitationEmail(invite, { track: tracker(log), getClient: fakeClient(log, sent) });
    expect(sent).toHaveLength(1);
    expect(sent[0].html!.endsWith("<!--team_invitation:new@hotel.nl-->")).toBe(true);
    expect(log).toEqual(["send", "onSent"]);
  });

  test("a failing send is not marked sent and the error propagates", async () => {
    const log: string[] = [];
    await expect(
      sendInvitationEmail(invite, { track: tracker(log), getClient: fakeClient(log, [], new Error("smtp down")) }),
    ).rejects.toThrow("smtp down");
    expect(log).toEqual([]);
  });
});
