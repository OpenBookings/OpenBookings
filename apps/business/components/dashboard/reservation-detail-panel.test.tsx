import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { toHostReservation, type HostReservationRow } from "@/lib/reservations/shape";
import { ReservationDetailBody } from "./reservation-detail-panel";

const row: HostReservationRow = {
  booking_id: "b0000000-0000-4000-8000-000000000011",
  status: "confirmed",
  check_in_date: "2031-11-10",
  check_out_date: "2031-11-12",
  guest_name: "Emma de Vries",
  guests: 2,
  adults: 2,
  children: 0,
  infants: 0,
  cots: 0,
  extra_beds: 0,
  pay_at_property_cents: 0,
  total_cents: 20650,
  timezone: "Europe/Amsterdam",
  check_in_time: "15:00",
  check_in_until: "22:00",
  check_out_time: "11:00",
  departed_early_on: null,
  confirmed_at: "2031-10-01T10:00:00+00:00",
  refunded_cents: 0,
  unsettled_refunds: 0,
  rooms: [
    {
      reservation_id: "r1",
      room_name: "Deluxe",
      cancellation_tier: "flex",
      check_in_at: "2031-11-10T14:00:00+00:00",
      full_refund_until: "2031-11-09T14:00:00+00:00",
      nights: [{ date: "2031-11-10", priceCents: 10000, touristTaxCents: 325 }],
      cancelled_at: null,
    },
  ],
};

const reservation = toHostReservation(row, new Date("2031-11-01T10:00:00Z"));
const seal = { opened: null, busy: false, error: null, onBreak: () => {} };

const render = (siteMinder: React.ComponentProps<typeof ReservationDetailBody>["siteMinder"]) =>
  renderToStaticMarkup(<ReservationDetailBody reservation={reservation} seal={seal} siteMinder={siteMinder} />);

describe("booking panel, SiteMinder block", () => {
  test("not connected to SiteMinder: no block at all", () => {
    const html = render(null);
    expect(html).not.toContain("SiteMinder");
  });

  test("while it is checked: the small loader, not a placeholder", () => {
    expect(render({ loading: true, delivery: null })).toContain("Checking SiteMinder");
  });

  test("sent: one mint badge at the end, no alert", () => {
    const html = render({ loading: false, delivery: { status: "delivered", acknowledgedAt: "2031-10-01T12:02:00Z" } });
    expect(html).toContain('data-tone="positive"');
    expect(html).toContain("Sent 1 Oct, 14:02");
    expect(html).not.toContain("Not in SiteMinder yet");
    expect(html.indexOf("SiteMinder")).toBeGreaterThan(html.indexOf("Emma de Vries"));
  });

  test("not delivered: amber badge, and the alert opens the panel", () => {
    const html = render({ loading: false, delivery: { status: "needs_attention", acknowledgedAt: null } });
    expect(html).toContain("Not delivered");
    expect(html).toContain("Not in SiteMinder yet");
    expect(html).toContain("Add it in SiteMinder or your PMS by hand, or check the connection.");
    expect(html.indexOf("Not in SiteMinder yet")).toBeLessThan(html.indexOf("Emma de Vries"));
  });

  test("never told: nothing to show", () => {
    expect(render({ loading: false, delivery: null })).not.toContain("SiteMinder");
  });
});
