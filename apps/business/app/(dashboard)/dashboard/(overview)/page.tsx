import { PageHeader } from "@/components/dashboard/page-header";
import { NoAccessPage } from "@/components/dashboard/no-access-page";
import { PageHold } from "@/components/dashboard/page-loaders";
import { SectionCards } from "@/components/dashboard/section-cards";
import { SiteHeader } from "@/components/dashboard/site-header";
import { ReservationsTabs } from "@/components/dashboard/reservations-tabs";
import {
  bucketReservations,
  mockReservations,
  type ReservationBuckets,
} from "@/components/dashboard/mock-reservations";
import { pageAccess } from "@/lib/page-access";

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function count(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "Saturday, 21 November". The same day the buckets below are cut on, which
 * is the UTC date until the overview reads real bookings in the property's
 * own timezone: the title and the counts have to agree on what today is.
 */
function todayTitle(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")}`;
}

/** "Two bookings check out and three check in today. Nine guests are staying with you." */
function daySummary(buckets: ReservationBuckets): string {
  const out = buckets.checkOuts.length;
  const into = buckets.checkIns.length;
  const staying = buckets.inHouse.reduce((sum, r) => sum + r.guests, 0);

  const leaving = `${count(out)} ${out === 1 ? "booking checks" : "bookings check"} out`;
  const arriving = (withNoun: boolean) =>
    `${count(into)}${withNoun ? (into === 1 ? " booking" : " bookings") : ""} ${into === 1 ? "checks" : "check"} in`;

  let movement: string;
  if (out === 0 && into === 0) movement = "nobody checks in or out today.";
  else if (into === 0) movement = `${leaving} today.`;
  else if (out === 0) movement = `${arriving(true)} today.`;
  else movement = `${leaving} and ${arriving(false)} today.`;

  const inHouse =
    staying === 0
      ? "No guests are staying with you right now."
      : `${capitalise(count(staying))} ${staying === 1 ? "guest is" : "guests are"} staying with you.`;

  return `${capitalise(movement)} ${inHouse}`;
}

export default async function DashboardPage() {
  const access = await pageAccess("overview");
  if (access.level === "none") {
    return (
      <>
        <SiteHeader title="Overview" />
        <div className="flex min-h-0 flex-1 flex-col py-4 md:py-6">
          <PageHold id="overview" fill>
            <NoAccessPage navKey="overview" current={access.current} />
          </PageHold>
        </div>
      </>
    );
  }
  const buckets = bucketReservations(mockReservations);

  return (
    <>
      <SiteHeader title="Overview" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            <PageHold id="overview">
              <PageHeader title={todayTitle(new Date())} description={daySummary(buckets)} className="px-4 lg:px-6" />
              <SectionCards buckets={buckets} />
              <ReservationsTabs buckets={buckets} />
            </PageHold>
          </div>
        </div>
      </div>
    </>
  );
}
