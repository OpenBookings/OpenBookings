import { describe, expect, test } from "bun:test";
import type { ReviewMail } from "@openbookings/db/reviews";
import { excerptOf, sendModerationDecision, sendReportOutcomes, sendReviewMail, sendReviewReplied } from "./review-send";
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

describe("sendModerationDecision", () => {
  const BOOKING = "22222222-2222-4222-8222-222222222222";
  type Author = { email: string | null; author_user_id: string | null; author_is_host: boolean; property_name: string; booking_id: string; text: string | null; opted_out: boolean };
  const author: Author = {
    email: "anna@example.com",
    author_user_id: "g1",
    author_is_host: false,
    property_name: "Canal House",
    booking_id: BOOKING,
    text: "Jan Jansen\nat the desk was rude",
    opted_out: false,
  };
  /** The author lookup, and the review context the rewrite check reads. */
  function setup(row: Author | null, rewriteOpen = true) {
    const sent: { from: string; to: string; subject: string; html: string }[] = [];
    const reported: unknown[] = [];
    const deps = {
      db: {
        query: async (sql: string) => {
          if (sql.includes("FROM bookings b")) {
            // getReviewContext: a removed review, rewrite unused, checked out a week ago or long ago.
            return {
              rows: [
                {
                  booking_id: BOOKING, user_id: "g1", status: "confirmed", no_show_reported_at: null,
                  check_out_date: rewriteOpen ? "2027-03-10" : "2026-01-10", check_out_time: "11:00", timezone: "Europe/Amsterdam",
                  property_id: "p1", property_name: "Canal House", property_slug: "canal-house", guest_first_name: "Anna", guest_country: "NL",
                  room_label: null, review_id: "r1", review_score: 4, review_body: "x", review_status: "removed", review_rewrite_used: false,
                  review_created_at: new Date("2027-03-12T00:00:00Z"),
                },
              ],
            };
          }
          if (sql.includes("FROM review_replies rr") && sql.includes("review_id =")) return { rows: [] };
          return { rows: row ? [row] : [] };
        },
      },
      transport: async (m: { from: string; to: string; subject: string; html: string }) => {
        sent.push(m);
      },
      testing: false,
      urls,
      now: () => new Date("2027-03-14T00:00:00Z"),
    };
    const run = (decision: "kept" | "removed", item: { kind: "review" | "reply"; id: string } = { kind: "review", id: REVIEW }) =>
      sendModerationDecision(item, decision, { rules: ["personal_details"], note: "Names staff", report: (e) => reported.push(e) }, deps);
    return { sent, reported, run };
  }

  test("a removal goes to the guest with the rules, the note and a one-line excerpt", async () => {
    const { sent, run } = setup(author);
    await run("removed");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("anna@example.com");
    expect(sent[0]!.subject).toBe("Your review of Canal House was removed");
    expect(sent[0]!.html).toContain("Names staff");
    expect(sent[0]!.html).toContain("Jan Jansen at the desk was rude");
    expect(sent[0]!.html).toContain(`https://openbookings.co/bookings/${BOOKING}/review`);
  });

  test("a removal is sent even with review emails turned off, a kept mail is not", async () => {
    const { sent, run } = setup({ ...author, opted_out: true });
    await run("kept");
    expect(sent).toEqual([]);
    await run("removed");
    expect(sent).toHaveLength(1);
  });

  test("a kept mail is sent when review emails are on", async () => {
    const { sent, run } = setup(author);
    await run("kept");
    expect(sent[0]!.subject).toBe("Your review of Canal House stays");
  });

  test("an anonymized guest gets no email", async () => {
    const { sent, run } = setup({ ...author, author_user_id: null, email: null });
    await run("removed");
    await run("kept");
    expect(sent).toEqual([]);
  });

  test("the rewrite is offered only while it is unused and the window is open", async () => {
    const open = setup(author, true);
    await open.run("removed");
    expect(open.sent[0]!.html).toContain("write your review once more");
    const closed = setup(author, false);
    await closed.run("removed");
    expect(closed.sent[0]!.html).not.toContain("write your review once more");
  });

  test("a reply never offers a rewrite, and a host reply links to the business reviews page", async () => {
    const { sent, run } = setup({ ...author, author_is_host: true, email: "host@example.com" });
    await run("removed", { kind: "reply", id: REVIEW });
    expect(sent[0]!.to).toBe("host@example.com");
    expect(sent[0]!.html).not.toContain("write your review once more");
    expect(sent[0]!.html).toContain("https://business.openbookings.co/dashboard/bookings/reviews");
  });

  test("a failed send is reported, not thrown", async () => {
    const { reported, run } = setup(author);
    const failing = {
      db: { query: async () => ({ rows: [author] }) },
      transport: async () => {
        throw new Error("smtp down");
      },
      urls,
    };
    await sendModerationDecision({ kind: "reply", id: REVIEW }, "kept", { rules: [], note: null, report: (e) => reported.push(e) }, failing);
    expect(reported).toHaveLength(1);
    await run("removed");
  });
});

describe("excerptOf", () => {
  test("is one line of at most 120 characters", () => {
    expect(excerptOf("a\n\n b")).toBe("a b");
    expect(excerptOf("x".repeat(300))).toBe(`${"x".repeat(120)}…`);
    expect(excerptOf(null)).toBe("");
  });
});

describe("sendReportOutcomes", () => {
  const rows = [
    { reporter_kind: "host", reporter_email: null, user_email: "host@example.com", property_name: "Canal House" },
    { reporter_kind: "public", reporter_email: "pat@example.com", user_email: null, property_name: "Canal House" },
    { reporter_kind: "public", reporter_email: null, user_email: null, property_name: "Canal House" },
  ];
  function run(upheld: boolean, failFor?: string) {
    const sent: { to: string; subject: string; html: string }[] = [];
    const reported: unknown[] = [];
    const deps = {
      db: { query: async () => ({ rows }) },
      transport: async (m: { from: string; to: string; subject: string; html: string }) => {
        if (m.to === failFor) throw new Error("smtp down");
        sent.push(m);
      },
      urls,
      report: (e: unknown) => reported.push(e),
    };
    return { sent, reported, go: (ids = [REVIEW, REVIEW, REVIEW]) => sendReportOutcomes(ids, upheld, deps) };
  }

  test("emails host reporters and public reporters with an email, and skips the rest", async () => {
    const { sent, go } = run(true);
    await go();
    expect(sent.map((m) => m.to)).toEqual(["host@example.com", "pat@example.com"]);
    expect(sent[0]!.html).toContain("removed it because it broke our review rules");
  });

  test("not upheld says it stays", async () => {
    const { sent, go } = run(false);
    await go();
    expect(sent[0]!.html).toContain("so it stays");
  });

  test("one failed address doesn't stop the next, and nothing throws", async () => {
    const { sent, reported, go } = run(true, "host@example.com");
    await go();
    expect(sent.map((m) => m.to)).toEqual(["pat@example.com"]);
    expect(reported).toHaveLength(1);
  });

  test("no report ids, no query", async () => {
    const { sent, go } = run(true);
    await go([]);
    expect(sent).toEqual([]);
  });
});
