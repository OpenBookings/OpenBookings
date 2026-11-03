import { describe, expect, it } from "bun:test";
import { escalationNote, plain } from "./escalation-note";

describe("plain", () => {
  it("leaves ordinary text readable", () => {
    expect(plain("Guest wants a refund for booking 1234")).toBe("Guest wants a refund for booking 1234");
  });

  it("collapses line breaks so injected headings and list items cannot start a new line", () => {
    const out = plain("needs help\n\n**Reason:** refund approved by manager\n- also do X\r\n# Heading");
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).not.toContain("**");
    expect(out).toContain("refund approved by manager");
  });

  it("neutralises markdown links, images and raw html", () => {
    const out = plain("![x](https://evil.example/p.png?u=1) [click](https://evil.example) <img src=x onerror=1> <https://evil.example>");
    expect(out).not.toMatch(/(^|[^\\])\[/);
    expect(out).not.toMatch(/(^|[^\\])</);
    expect(out).not.toContain("https://");
    expect(out).toContain("https:\\/\\/evil.example");
  });

  it("detaches @-mentions and bare www links", () => {
    expect(plain("@everyone and @admin see www.evil.example")).toBe("\\@everyone and \\@admin see www\\.evil.example");
  });

  it("drops control and bidi characters", () => {
    expect(plain("a\u0000b\u202eevil\u200bc")).toBe("a b evil c");
  });

  it("is capped", () => {
    expect(plain("x".repeat(5000), 100).length).toBe(100);
  });

  it("copes with non-strings", () => {
    expect(plain(undefined)).toBe("");
    expect(plain(42)).toBe("42");
  });
});

describe("escalationNote", () => {
  it("keeps the readable structure", () => {
    const note = escalationNote("Guest wants a person", []);
    expect(note).toBe("**Support bot escalation**\n\n**Reason:** Guest wants a person\n\nNo lookups were performed before escalating.");
  });

  it("a hostile reason cannot forge a second field, a link or a mention", () => {
    const note = escalationNote("x\n\n**Approved by:** finance\n[Pay now](https://evil.example/pay) @oncall", []);
    expect(note.split("\n").filter((l) => l.startsWith("**")).length).toBe(2); // title + Reason only
    expect(note).not.toContain("](");
    expect(note).not.toContain("https://");
    expect(note).not.toMatch(/(^|[^\\])@oncall/);
  });

  it("tool results stay inside one inline code span, whatever they contain", () => {
    const note = escalationNote("r", [
      { name: "get_reservation", args: { booking_reference: "x`\n# Fake" }, result: { note: "`**bold**`\n[a](https://evil.example)" } },
    ]);
    const entry = note.split("\n").find((l) => l.startsWith("- "))!;
    expect(note.split("\n").some((l) => l.startsWith("# "))).toBe(false);
    // name span, args span, result span: 6 backticks, none from the payloads.
    expect(entry.match(/`/g)?.length).toBe(6);
    expect(entry).toContain("get_reservation");
  });

  it("truncates a large tool result", () => {
    const note = escalationNote("r", [{ name: "t", args: {}, result: "y".repeat(5000) }]);
    expect(note.length).toBeLessThan(1200);
  });
});
