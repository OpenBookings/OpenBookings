import { describe, expect, test } from "bun:test";
import { consoleEmailClient, formatConsoleEmail } from "./client";

describe("consoleEmailClient", () => {
  test("prints the message and its links instead of sending it", async () => {
    const out: string[] = [];
    const client = consoleEmailClient((text) => out.push(text));

    const result = await client
      .from("OpenBookings <noreply@openbookings.test>")
      .to("guest@openbookings.test")
      .subject("Your sign-in link")
      .html('<a href="http://web.localhost:3002/api/auth/magic-link/verify?token=abc&amp;callbackURL=%2F">Sign in</a>')
      .send();

    expect(result).toMatchObject({ status: "logged" });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("To:      guest@openbookings.test");
    expect(out[0]).toContain("Subject: Your sign-in link");
    expect(out[0]).toContain("http://web.localhost:3002/api/auth/magic-link/verify?token=abc&callbackURL=%2F");
  });

  test("keeps messages from separate chains apart", async () => {
    const out: string[] = [];
    const client = consoleEmailClient((text) => out.push(text));
    await client.from("a@x.test").to("one@x.test").subject("One").html("<p>1</p>").send();
    await client.from("a@x.test").to("two@x.test").subject("Two").text("plain body").send();

    expect(out[0]).toContain("one@x.test");
    expect(out[1]).toContain("two@x.test");
    expect(out[1]).toContain("plain body");
    expect(out[1]).not.toContain("One");
  });

  test("leaves a shared base builder unchanged, like Lettermint's immutable builder", async () => {
    const out: string[] = [];
    const base = consoleEmailClient((text) => out.push(text)).from("a@x.test").subject("Base");
    await base.to("one@x.test").send();
    await base.send();

    expect(out[0]).toContain("To:      one@x.test");
    expect(out[1]).not.toContain("one@x.test");
  });
});

describe("formatConsoleEmail", () => {
  test("lists link targets, not image sources", () => {
    const out = formatConsoleEmail({
      html: ['<img src="https://cdn.example.test/logo.png"><a href="https://app.example.test/verify?t=1">Go</a>'],
    });
    expect(out).toContain("https://app.example.test/verify?t=1");
    expect(out).not.toContain("logo.png");
  });

  test("joins a list of recipients", () => {
    expect(formatConsoleEmail({ to: [["a@x.test", "b@x.test"]] })).toContain("To:      a@x.test, b@x.test");
  });
});
