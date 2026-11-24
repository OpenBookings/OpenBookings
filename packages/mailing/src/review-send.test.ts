import { describe, expect, test } from "bun:test";
import type { ReviewMail } from "@openbookings/db/reviews";
import { sendReviewMail, sendReviewReplied } from "./review-send";
import type { trackMail } from "./tracking";

const REVIEW = "11111111-1111-4111-8111-111111111111";
const urls = { webUrl: "https://openbookings.co", businessUrl: "https://business.openbookings.co" };

type Row = {
  email: string | null;
  guest_first_name: string | null;
  guest_user_id: string | null;
  property_name: string;
  booking_id: string;
  opted_out: boolean;
  reply_body: string | null;
};

const base: Row = {
  email: "anna@example.com",
  guest_first_name: "Anna de",
  guest_user_id: "g1",
  property_name: "Canal House",
  booking_id: "b1",
  opted_out: false,
  reply_body: "Thank you, Anna.",
};

function setup(row: Row | null, transportError?: Error) {
  const sent: { from: string; to: string; subject: string; html: string }[] = [];
  const reported: unknown[] = [];
  const deps = {
    db: { query: async () => ({ rows: row ? [row] : [] }) },
    transport: async (m: { from: string; to: string; subject: string; html: string }) => {
      if (transportError) throw transportError;
      sent.push(m);
    },
    testing: false,
    urls,
  };
  const run = () => sendReviewReplied(REVIEW, { report: (e) => reported.push(e) }, deps);
  return { sent, reported, run };
}

describe("sendReviewReplied", () => {
  test("sends one mail to the guest with the reply and their review page", async () => {
    const { sent, run } = setup(base);
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("anna@example.com");
    expect(sent[0]!.from).toBe("Roy at OpenBookings <roy@openbookings.co>");
    expect(sent[0]!.subject).toBe("Canal House replied to your review");
    expect(sent[0]!.html).toContain("Hi Anna de,");
    expect(sent[0]!.html).toContain("Thank you, Anna.");
    expect(sent[0]!.html).toContain("https://openbookings.co/bookings/b1/review");
  });

  test("greets with 'there' when the guest has no first name", async () => {
    const { sent, run } = setup({ ...base, guest_first_name: "" });
    await run();
    expect(sent[0]!.html).toContain("Hi there,");
  });

  test("sends nothing when the guest turned review emails off", async () => {
    const { sent, run } = setup({ ...base, opted_out: true });
    await run();
    expect(sent).toEqual([]);
  });

  test("sends nothing for an anonymized review", async () => {
    const { sent, run } = setup({ ...base, guest_user_id: null, email: null });
    await run();
    expect(sent).toEqual([]);
  });

  test("sends nothing without a published host reply", async () => {
    const { sent, run } = setup({ ...base, reply_body: null });
    await run();
    expect(sent).toEqual([]);
  });

  test("a failed send is reported, not thrown", async () => {
    const { reported, run } = setup(base, new Error("smtp down"));
    await run();
    expect(reported).toHaveLength(1);
  });
});

describe("sendReviewMail tracking", () => {
  const owners = ["owner-a@example.test", "owner-b@example.test"];
  function run(mail: ReviewMail, failFor?: string) {
    const sent: { from: string; to: string; html: string }[] = [];
    const marked: string[] = [];
    const track: typeof trackMail = async ({ kind, to, html }) => ({
      html: `${html}<!--${kind}:${to}-->`,
      onSent: async () => {
        marked.push(`${kind}:${to}`);
      },
    });
    const deps = {
      db: { query: async () => ({ rows: owners.map((email) => ({ is_demo: false, email })) }) },
      transport: async (m: { from: string; to: string; subject: string; html: string }) => {
        if (m.to === failFor) throw new Error("smtp down");
        sent.push(m);
      },
      testing: false,
      urls,
      track,
    };
    return { sent, marked, go: () => sendReviewMail(mail, deps) };
  }
  const guest = (kind: "invitation" | "reminder"): ReviewMail => ({
    kind,
    bookingId: "b1",
    to: "anna@example.com",
    guestFirstName: "Anna",
    propertyName: "Canal House",
    checkOutDate: "2027-03-14",
    token: "tok",
    closesAt: new Date("2027-04-14T00:00:00Z"),
  });
  const warning: ReviewMail = {
    kind: "host_warning",
    propertyId: "11111111-1111-4111-8111-111111111111",
    propertyName: "Canal House",
    timeZone: "Europe/Amsterdam",
    stays: [{ bookingId: "b1", guestName: "Anna", guestEmail: "anna@example.com", checkInDate: "2027-03-12", checkOutDate: "2027-03-14", invitesAt: new Date("2027-03-15T10:00:00Z") }],
  };

  test.each([
    ["invitation", "review_invitation"],
    ["reminder", "review_reminder"],
  ] as const)("a %s is tracked as %s", async (kind, tracked) => {
    const { sent, marked, go } = run(guest(kind));
    await go();
    expect(sent[0]!.html.endsWith(`<!--${tracked}:anna@example.com-->`)).toBe(true);
    expect(marked).toEqual([`${tracked}:anna@example.com`]);
  });

  test("guest review mail comes from Roy, the host warning from Bookings", async () => {
    const invite = run(guest("invitation"));
    await invite.go();
    expect(invite.sent[0]!.from).toBe("Roy at OpenBookings <roy@openbookings.co>");
    const host = run(warning);
    await host.go();
    expect(host.sent.map((m) => m.from)).toEqual(owners.map(() => "OpenBookings Bookings <bookings@openbookings.co>"));
  });

  test("a host warning is tracked per owner", async () => {
    const { sent, marked, go } = run(warning);
    await go();
    for (const o of owners) expect(sent.find((m) => m.to === o)!.html.endsWith(`<!--stays_unconfirmed_host:${o}-->`)).toBe(true);
    expect(marked.sort()).toEqual(owners.map((o) => `stays_unconfirmed_host:${o}`));
  });

  test("an owner whose transport failed is not marked sent, and the error throws", async () => {
    const { marked, go } = run(warning, owners[0]);
    await expect(go()).rejects.toThrow("smtp down");
    expect(marked).toEqual([`stays_unconfirmed_host:${owners[1]}`]);
  });

  test("a failed invitation is not marked sent", async () => {
    const { marked, go } = run(guest("invitation"), "anna@example.com");
    await expect(go()).rejects.toThrow("smtp down");
    expect(marked).toEqual([]);
  });
});
