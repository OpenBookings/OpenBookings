import { afterEach, describe, expect, test } from "bun:test";
import { sender } from "./senders";

const original = process.env.EMAIL_DOMAIN;
afterEach(() => {
  if (original === undefined) delete process.env.EMAIL_DOMAIN;
  else process.env.EMAIL_DOMAIN = original;
});

describe("sender", () => {
  test("every role has its own name and mailbox on openbookings.co", () => {
    delete process.env.EMAIL_DOMAIN;
    expect(sender("magic")).toBe("OB Magic <magic@openbookings.co>");
    expect(sender("security")).toBe("OpenBookings Security <security@openbookings.co>");
    expect(sender("bookings")).toBe("OpenBookings Bookings <bookings@openbookings.co>");
    expect(sender("roy")).toBe("Roy at OpenBookings <roy@openbookings.co>");
    expect(sender("billing")).toBe("OpenBookings Billing <billing@openbookings.co>");
    expect(sender("support")).toBe("OpenBookings Support <support@openbookings.co>");
    expect(sender("noreply")).toBe("no-reply <noreply@openbookings.co>");
  });

  test("EMAIL_DOMAIN swaps the domain and keeps the name", () => {
    process.env.EMAIL_DOMAIN = " mail.example.test ";
    expect(sender("security")).toBe("OpenBookings Security <security@mail.example.test>");
  });

  test("an empty EMAIL_DOMAIN falls back to openbookings.co", () => {
    process.env.EMAIL_DOMAIN = "";
    expect(sender("magic")).toBe("OB Magic <magic@openbookings.co>");
  });
});
