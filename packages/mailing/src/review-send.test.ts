import { describe, expect, test } from "bun:test";
import type { ReviewMail } from "@openbookings/db/reviews";
import { sendMaskedPublicationNotices, sendModerationDecision, sendReportOutcomes, sendReviewMail, sendReviewReplied } from "./review-send";
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

describe("decision notices", () => {
  const BOOKING = "22222222-2222-4222-8222-222222222222";
  type Author = { email: string | null; author_user_id: string | null; author_is_host: boolean; property_name: string; booking_id: string };
  const author: Author = { email: "anna@example.com", author_user_id: "g1", author_is_host: false, property_name: "Canal House", booking_id: BOOKING };
  function setup(row: Author | null) {
    const sent: { from: string; to: string; subject: string; html: string }[] = [];
    const reported: unknown[] = [];
    const queries: string[] = [];
    const deps = {
      db: { query: async (sql: string) => { queries.push(sql); return { rows: row ? [row] : [] }; } },
      transport: async (m: { from: string; to: string; subject: string; html: string }) => { sent.push(m); },
      testing: false,
      urls,
    };
    const item = (kind: "review" | "reply" = "review") => ({ kind, id: REVIEW });
    return { sent, reported, queries, deps, item, report: (e: unknown) => reported.push(e) };
  }

  test("removal notice links to the review page and carries no rules, note or excerpt", async () => {
    const { sent, deps, item } = setup(author);
    await sendModerationDecision(item(), "removed", {}, deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("anna@example.com");
    expect(sent[0]!.subject).toBe("Your review of Canal House was removed");
    expect(sent[0]!.html).toContain(`https://openbookings.co/bookings/${BOOKING}/review`);
    expect(sent[0]!.html).not.toContain("Note from the moderator");
    expect(sent[0]!.html).not.toContain("border-left");
    expect(sent[0]!.html).not.toContain("write your review once more");
  });

  test("masked notice is sent only when parts were masked", async () => {
    // The sweep hands over only items it published with masking; nothing handed over, nothing sent.
    const { sent, deps, item } = setup(author);
    await sendMaskedPublicationNotices([], {}, deps);
    expect(sent).toEqual([]);
    await sendMaskedPublicationNotices([item(), item("reply")], {}, deps);
    expect(sent.map((m) => m.subject)).toEqual([
      "Your review of Canal House is live with some parts removed",
      "Your reply of Canal House is live with some parts removed",
    ]);
  });

  test("host reply notices link to the business reviews page", async () => {
    const { sent, deps, item } = setup({ ...author, author_is_host: true, email: "host@example.com" });
    await sendModerationDecision(item("reply"), "removed", {}, deps);
    await sendMaskedPublicationNotices([item("reply")], {}, deps);
    expect(sent.map((m) => m.to)).toEqual(["host@example.com", "host@example.com"]);
    for (const m of sent) expect(m.html).toContain("https://business.openbookings.co/dashboard/bookings/reviews");
  });

  test("no email when an item is kept", async () => {
    const { sent, queries, deps, item } = setup(author);
    await sendModerationDecision(item(), "kept", {}, deps);
    expect(sent).toEqual([]);
    expect(queries).toEqual([]);
  });

  test("notices are sent with review emails turned off, never to anonymized authors", async () => {
    // The lookup doesn't read the opt-out at all: service messages.
    const { sent, queries, deps, item } = setup(author);
    await sendModerationDecision(item(), "removed", {}, deps);
    await sendMaskedPublicationNotices([item()], {}, deps);
    expect(sent).toHaveLength(2);
    for (const q of queries) expect(q).not.toContain("opt_out");

    const gone = setup({ ...author, author_user_id: null, email: null });
    await sendModerationDecision(gone.item(), "removed", {}, gone.deps);
    await sendMaskedPublicationNotices([gone.item()], {}, gone.deps);
    expect(gone.sent).toEqual([]);
  });

  test("a failed send is reported, not thrown, and doesn't stop the next notice", async () => {
    const reported: unknown[] = [];
    let calls = 0;
    const deps = {
      db: { query: async () => ({ rows: [author] }) },
      transport: async () => {
        if (++calls === 1) throw new Error("smtp down");
      },
      urls,
    };
    await sendMaskedPublicationNotices([{ kind: "review", id: REVIEW }, { kind: "review", id: REVIEW }], { report: (e) => reported.push(e) }, deps);
    expect(reported).toHaveLength(1);
    expect(calls).toBe(2);
    await sendModerationDecision({ kind: "review", id: REVIEW }, "removed", { report: (e) => reported.push(e) }, { ...deps, db: { query: async () => { throw new Error("db"); } } });
    expect(reported).toHaveLength(2);
  });

  test("a public reporter is emailed only at the address on the form; a reply report says reply", async () => {
    const sent: { to: string; html: string }[] = [];
    const rows = [
      { reporter_kind: "public", reporter_email: null, user_email: "account@example.com", property_name: "Canal House", is_reply: false },
      { reporter_kind: "public", reporter_email: "pat@example.com", user_email: "account@example.com", property_name: "Canal House", is_reply: true },
    ];
    const deps = { db: { query: async () => ({ rows }) }, transport: async (m: { to: string; html: string }) => { sent.push(m); }, urls };
    await sendReportOutcomes([REVIEW, REVIEW], true, deps);
    expect(sent.map((m) => m.to)).toEqual(["pat@example.com"]);
    expect(sent[0]!.html).toContain("about a reply at");
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
