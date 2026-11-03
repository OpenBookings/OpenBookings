import { describe, expect, test } from "bun:test";
import { invitationUrl, renderInvitation } from "./invitation";

const invite = {
  invitationId: "abc 123",
  email: "new@hotel.nl",
  role: "frontdesk",
  organizationName: "Hotel <script>",
  inviterName: 'Olga "O" Owner',
  expiresAt: new Date("2026-11-10T12:00:00Z"),
};

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

  test("links to the invite page on our own origin", () => {
    expect(invitationUrl("abc 123", "https://business.example")).toBe("https://business.example/invite/abc%20123");
    expect(renderInvitation(invite, "https://business.example").html).toContain(
      "https://business.example/invite/abc%20123",
    );
  });
});
