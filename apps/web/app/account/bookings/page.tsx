import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, ChevronRight, Hotel } from "lucide-react";
import { query } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";
import { todayInEurope } from "@/lib/account/deletion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LinkTabs } from "../_components/LinkTabs";
import { EmptyCard, PageHeader } from "../_components/section";
import {
  BOOKING_TABS,
  GUEST_BOOKINGS_SQL,
  groupBookings,
  parseTab,
  type BookingTab,
  type GuestBookingListRow,
} from "./_lib/list";

export const metadata: Metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

const euros = new Intl.NumberFormat("en-NL", { style: "currency", currency: "EUR" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDay = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));

const STATUS: Partial<Record<GuestBookingListRow["status"], string>> = {
  checked_in: "Checked in",
  completed: "Stay completed",
  no_show: "No-show",
};

const EMPTY: Record<BookingTab, { title: string; body: string }> = {
  upcoming: { title: "No upcoming stays", body: "When you book a room, it shows up here with everything you need for check-in." },
  past: { title: "No past stays yet", body: "Stays you've completed are kept here." },
  cancelled: { title: "Nothing cancelled", body: "Bookings you or the property cancel are listed here." },
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function BookingCard({ booking }: { booking: GuestBookingListRow }) {
  const status = STATUS[booking.status];
  return (
    <li>
      <Card className="group relative flex-row items-stretch gap-0 overflow-hidden py-0 transition-colors hover:bg-accent">
        <div className="relative hidden w-36 shrink-0 bg-secondary sm:block">
          {booking.hero_image_url ? (
            <Image src={booking.hero_image_url} alt="" fill sizes="144px" className="object-cover" />
          ) : (
            <Hotel aria-hidden className="absolute inset-0 m-auto size-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <Link
                href={`/bookings/${booking.booking_id}`}
                className="truncate outline-none after:absolute after:inset-0 focus-visible:underline"
              >
                {booking.property_name}
              </Link>
              {status ? <Badge variant="secondary" className="text-muted-foreground">{status}</Badge> : null}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {fmtDay(booking.check_in_date)} – {fmtDay(booking.check_out_date)}
              {booking.city ? ` · ${booking.city}` : ""}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {plural(booking.rooms, "room", "rooms")} · {plural(booking.guests, "guest", "guests")} ·{" "}
              {euros.format(booking.total_paid)} · Ref {booking.booking_id.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </Card>
    </li>
  );
}

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const session = await getServerSession();
  if (!session) return null; // The layout shows the sign-in form.

  const tab = parseTab((await searchParams).tab);
  const rows = await query<GuestBookingListRow>(GUEST_BOOKINGS_SQL, [session.user.id]);
  const groups = groupBookings(rows, todayInEurope());
  const list = groups[tab];

  return (
    <>
      <PageHeader title="Bookings" description="Your stays, and everything you need to change or cancel them." />
      <div className="flex flex-col gap-4">
        <LinkTabs
          label="Bookings"
          tabs={BOOKING_TABS.map((t) => ({
            href: t.id === "upcoming" ? "/account/bookings" : `/account/bookings?tab=${t.id}`,
            title: t.title,
            count: groups[t.id].length,
            current: t.id === tab,
          }))}
        />
        {list.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {list.map((booking) => (
              <BookingCard key={booking.booking_id} booking={booking} />
            ))}
          </ul>
        ) : (
          <EmptyCard
            icon={<CalendarDays aria-hidden />}
            title={EMPTY[tab].title}
            body={EMPTY[tab].body}
            action={
              tab === "upcoming" ? (
                <Button asChild variant="outline" className="mt-2 h-11">
                  <Link href="/">Find a place to stay</Link>
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </>
  );
}
