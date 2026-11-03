import { describe, expect, test } from "bun:test";
import { escapeHtml, loadTemplate } from "@openbookings/mailing";

// The mailing package has no test runner of its own; these live next to its
// busiest caller.
describe("loadTemplate", () => {
  const magic = (vars: Record<string, string>) => loadTemplate("magic-link", vars);

  test("escapes values so an address or URL cannot inject markup", () => {
    const html = magic({
      email: `"><img src=x onerror=alert(1)>@evil.example`,
      magicLinkUrl: `https://openbookings.co/x?a=1&b=2"><script>alert(1)</script>`,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;@evil.example");
    expect(html).toContain("a=1&amp;b=2&quot;&gt;&lt;script&gt;");
  });

  test("a value containing a placeholder is not expanded a second time", () => {
    const html = magic({ email: "{{magicLinkUrl}}", magicLinkUrl: "https://openbookings.co/real" });
    // The email slot shows the literal text; it did not pull in the other value.
    expect(html).toContain("{{magicLinkUrl}}");
    expect(html.match(/https:\/\/openbookings\.co\/real/g)?.length).toBe(2); // href + display line only
  });

  test("htmlSlots opt in to raw markup, and only those", () => {
    const html = loadTemplate(
      "account-action",
      {
        subject: "<b>subject</b>",
        preheader: "<i>pre</i>",
        eyebrow: "Account",
        headline: "Change your<br />email?",
        body: "<strong>ok</strong>",
        ctaUrl: "https://openbookings.co/a?x=1&y=2",
        ctaLabel: "Go",
        footnote: "<a href=\"mailto:a@b.co\">help</a>",
      },
      { htmlSlots: ["headline", "body", "footnote"] },
    );
    expect(html).toContain("Change your<br />email?");
    expect(html).toContain("<strong>ok</strong>");
    expect(html).toContain('<a href="mailto:a@b.co">help</a>');
    expect(html).toContain("&lt;b&gt;subject&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;pre&lt;/i&gt;");
    expect(html).toContain("https://openbookings.co/a?x=1&amp;y=2");
  });

  test("a placeholder with no variable is left as written; an unknown template throws", () => {
    expect(loadTemplate("magic-link", { email: "a@b.co" })).toContain("{{magicLinkUrl}}");
    expect(() => loadTemplate("nope", {})).toThrow('No email template found: "nope"');
  });

  test("Object.prototype keys are not variables", () => {
    expect(loadTemplate("magic-link", { email: "a@b.co" }, {})).not.toContain("[object Object]");
  });
});

describe("escapeHtml", () => {
  test("escapes & < > \" '", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
