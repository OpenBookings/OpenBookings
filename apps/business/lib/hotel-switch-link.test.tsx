import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleLink } from "@/components/dashboard/console-link";
import { switchesHotel } from "./hotel-switch-link";

describe("switchesHotel", () => {
  test("a link with a property param switches the hotel", () => {
    expect(switchesHotel("/dashboard/listings/property?property=p1")).toBe(true);
    expect(switchesHotel("/dashboard/listings/rates-availability?tab=x&property=p1#top")).toBe(true);
  });

  test("other links do not", () => {
    expect(switchesHotel("/dashboard/finance")).toBe(false);
    expect(switchesHotel("#billing-details")).toBe(false);
    expect(switchesHotel("/dashboard/bookings/reservations?id=b1")).toBe(false);
    expect(switchesHotel("/dashboard/listings/pricing-rules?plan=r1#property=p1")).toBe(false);
    expect(switchesHotel("/dashboard?propertyName=x")).toBe(false);
  });
});

describe("ConsoleLink", () => {
  test("renders a hotel-switching link as a plain anchor with its styling", () => {
    const html = renderToStaticMarkup(
      <ConsoleLink href="/dashboard/listings/property?property=p1" className="underline">
        Fix it
      </ConsoleLink>,
    );
    expect(html).toBe('<a href="/dashboard/listings/property?property=p1" class="underline">Fix it</a>');
  });
});
