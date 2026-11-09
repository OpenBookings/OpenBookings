import { describe, expect, test } from "bun:test";
import { formatStayMonth, guestReviewInvitation, guestReviewPosted, hostUnconfirmedStays } from "./review-mail";

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

  test("formatStayMonth", () => {
    expect(formatStayMonth("2031-01-31")).toBe("January 2031");
  });
});
