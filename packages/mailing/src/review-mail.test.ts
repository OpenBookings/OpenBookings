import { MODERATION_DEADLINE_HOURS, REVIEW_RULES } from "@openbookings/pricing";
import { describe, expect, test } from "bun:test";
import {
  formatStayMonth,
  guestReviewInvitation,
  guestReviewPosted,
  guestReviewReplied,
  hostUnconfirmedStays,
  moderationMaskedNotice,
  moderationRemovedNotice,
  reportOutcome,
} from "./review-mail";

const invitation = {
  guestFirstName: "Anna",
  propertyName: "Hotel <Test>",
  checkOutDate: "2031-11-12",
  reviewUrl: "https://openbookings.co/review/abc",
  optOutUrl: "https://openbookings.co/review/abc/stop",
  closesAt: new Date("2031-12-12T10:00:00Z"),
};

describe("review mails", () => {
  test("the invitation names the month, never the dates, and escapes the property name", () => {
    const mail = guestReviewInvitation(invitation);
    expect(mail.subject).toBe("How was your stay at Hotel <Test>?");
    expect(mail.html).toContain("November 2031");
    expect(mail.html).not.toContain("12 Nov");
    expect(mail.html).toContain("Hotel &lt;Test&gt;");
    expect(mail.html).not.toContain("Hotel <Test>");
  });

  test("the invitation links to the review and to the opt-out", () => {
    const mail = guestReviewInvitation(invitation);
    expect(mail.html).toContain("https://openbookings.co/review/abc");
    expect(mail.html).toContain("https://openbookings.co/review/abc/stop");
    expect(mail.html).toContain("12 December");
  });

  test("the posted mail says when a review waits for a person", () => {
    const pending = guestReviewPosted({ propertyName: "Hotel", pending: true, manageUrl: "https://x/y" });
    expect(pending.html).toContain("A person looks at it");
    expect(pending.html).toContain(`within ${MODERATION_DEADLINE_HOURS} hours`);
    expect(pending.html).not.toContain("such as a link or contact details");
    const posted = guestReviewPosted({ propertyName: "Hotel", pending: false, manageUrl: "https://x/y" });
    expect(posted.html).toContain("is posted");
  });

  test("the host warning lists each stay and the deadline", () => {
    const mail = hostUnconfirmedStays({
      propertyName: "Hotel",
      stays: [
        { guestName: "Anna de Vries", checkInDate: "2031-11-10", checkOutDate: "2031-11-12" },
        { guestName: "Ben <b>", checkInDate: "2031-11-11", checkOutDate: "2031-11-12" },
      ],
      invitesAt: "Thu 13 Nov, 11:00",
      reservationsUrl: "https://business.openbookings.co/dashboard/bookings/reservations",
    });
    expect(mail.subject).toBe("2 stays at Hotel not marked as arrived");
    expect(mail.html).toContain("Anna de Vries");
    expect(mail.html).toContain("Ben &lt;b&gt;");
    expect(mail.html).toContain("Thu 13 Nov, 11:00");
  });

  const replied = {
    guestFirstName: "Anna",
    propertyName: "Hotel",
    replyBody: "Thanks <b>Anna</b>",
    manageUrl: "https://openbookings.co/bookings/b1/review",
    settingsUrl: "https://openbookings.co/account/privacy",
  };

  test("the reply mail quotes the reply and escapes it", () => {
    const mail = guestReviewReplied(replied);
    expect(mail.subject).toBe("Hotel replied to your review");
    expect(mail.html).toContain("Thanks &lt;b&gt;Anna&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Anna</b>");
    expect(mail.html).toContain("Hi Anna");
  });

  test("the reply mail links to the review page and the email setting", () => {
    const mail = guestReviewReplied(replied);
    expect(mail.html).toContain("https://openbookings.co/bookings/b1/review");
    expect(mail.html).toContain("See the reply");
    expect(mail.html).toContain("https://openbookings.co/account/privacy");
    expect(mail.html).toContain("Turn off review emails");
  });

  test("formatStayMonth", () => {
    expect(formatStayMonth("2031-01-31")).toBe("January 2031");
  });
});

describe("moderation mails", () => {
  const notice = {
    itemKind: "review" as const,
    audience: "guest" as const,
    propertyName: "Hotel <Test>",
    pageUrl: "https://openbookings.co/bookings/b1/review",
  };

  test("the removal notice is short: it says removed, names the property, links the page", () => {
    const mail = moderationRemovedNotice(notice);
    expect(mail.subject).toBe("Your review of Hotel <Test> was removed");
    expect(mail.html).toContain("Hotel &lt;Test&gt;");
    expect(mail.html).toContain("https://openbookings.co/bookings/b1/review");
    expect(mail.html).not.toContain("Note from the moderator");
    expect(mail.html).not.toContain("border-left");
    for (const rule of Object.values(REVIEW_RULES)) expect(mail.html).not.toContain(rule.title);
  });

  test("the masked notice says it is live with some parts removed", () => {
    const mail = moderationMaskedNotice(notice);
    expect(mail.subject).toBe("Your review of Hotel <Test> is live with some parts removed");
    expect(mail.html).toContain("https://openbookings.co/bookings/b1/review");
  });

  test("a reply is called a reply, and a host gets the reviews button", () => {
    const reply = { ...notice, itemKind: "reply" as const, audience: "host" as const, pageUrl: "https://business.openbookings.co/dashboard/bookings/reviews" };
    expect(moderationRemovedNotice(reply).subject).toBe("Your reply of Hotel <Test> was removed");
    expect(moderationMaskedNotice(reply).subject).toBe("Your reply of Hotel <Test> is live with some parts removed");
    expect(moderationRemovedNotice(reply).html).toContain("Open reviews");
  });

  test("the outcome email says upheld or not", () => {
    expect(reportOutcome({ upheld: true, propertyName: "Hotel" }).html).toContain("removed it because it broke our review rules");
    const no = reportOutcome({ upheld: false, propertyName: "Hotel" }).html;
    expect(no).toContain("so it stays");
    expect(no).not.toContain("removed it because");
  });
});
