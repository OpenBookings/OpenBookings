import { describe, expect, test } from "bun:test";
import { sendReviewReplied } from "./review-send";

const REVIEW = "11111111-1111-4111-8111-111111111111";
const urls = { webUrl: "https://openbookings.co", businessUrl: "https://business.openbookings.co" };

type Row = {
  email: string | null;
  guest_name: string | null;
  guest_user_id: string | null;
  property_name: string;
  booking_id: string;
  opted_out: boolean;
  reply_body: string | null;
};

const base: Row = {
  email: "anna@example.com",
  guest_name: "Anna de Vries",
  guest_user_id: "g1",
  property_name: "Canal House",
  booking_id: "b1",
  opted_out: false,
  reply_body: "Thank you, Anna.",
};

function setup(row: Row | null, transportError?: Error) {
  const sent: { to: string; subject: string; html: string }[] = [];
  const reported: unknown[] = [];
  const deps = {
    db: { query: async () => ({ rows: row ? [row] : [] }) },
    transport: async (m: { to: string; subject: string; html: string }) => {
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
    expect(sent[0]!.subject).toBe("Canal House replied to your review");
    expect(sent[0]!.html).toContain("Hi Anna,");
    expect(sent[0]!.html).toContain("Thank you, Anna.");
    expect(sent[0]!.html).toContain("https://openbookings.co/bookings/b1/review");
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
