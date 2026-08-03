import { Suspense } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { AriView } from "./_components/ari-view";
import {
  addDays,
  loadAriGrid,
  loadHostProperties,
  toIsoDate,
} from "./_lib/ari-query";
import { buildMockAriGrid } from "./_lib/mock-ari";
import { STAY_LENGTHS } from "./_lib/types";

const DEFAULT_WINDOW_DAYS = 14;
const ALLOWED_WINDOWS = [7, 14, 30];

interface PageProps {
  searchParams: Promise<{
    start?: string;
    days?: string;
    stay?: string;
    property?: string;
    demo?: string;
  }>;
}

/** Query params are user input — clamp them rather than trusting the URL. */
function parseParams(params: Awaited<PageProps["searchParams"]>) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(params.start ?? "")
    ? params.start!
    : toIsoDate(new Date());

  const requestedDays = Number(params.days);
  const windowDays = ALLOWED_WINDOWS.includes(requestedDays)
    ? requestedDays
    : DEFAULT_WINDOW_DAYS;

  const requestedStay = Number(params.stay);
  const stayLength = (STAY_LENGTHS as readonly number[]).includes(requestedStay)
    ? requestedStay
    : 1;

  return { start, windowDays, stayLength };
}

export default async function RatesAvailabilityPage({
  searchParams,
}: PageProps) {
  return (
    // No header of its own: the listings layout already puts the section name
    // and search in a bar above this, and a second one only steals grid height.
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<GridSkeleton />}>
        <AriContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AriContent({ searchParams }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const params = await searchParams;
  const { start, windowDays, stayLength } = parseParams(params);

  // Opt-in, never a fallback: a property with real-but-thin data should look
  // thin. Quietly substituting invented numbers on an inventory screen is how
  // a host closes rooms they did not mean to close.
  if (params.demo === "1") {
    const demo = buildMockAriGrid(start, windowDays, stayLength);
    return (
      <>
        <DemoBanner />
        <AriView
          key="demo"
          data={demo}
          startDate={start}
          windowDays={windowDays}
        />
      </>
    );
  }

  const properties = await loadHostProperties(session);
  if (properties.length === 0) return <EmptyState />;

  const property =
    properties.find((p) => p.id === params.property) ?? properties[0];

  const data = await loadAriGrid(
    session,
    property.id,
    { start, end: addDays(start, windowDays - 1) },
    { stayLength },
  );

  if (!data) return <EmptyState />;

  // Keyed on the property alone: moving through weeks, ranges or stay lengths
  // must not remount the shell, or the host's filters and expanded rows are
  // thrown away on every chevron press. Switching property is a different
  // dataset, so there a fresh shell is right.
  return (
    <AriView
      key={property.id}
      data={data}
      startDate={start}
      windowDays={windowDays}
    />
  );
}

/**
 * Unmissable, because every edit control on the screen below is live UI over
 * data that does not exist. Nothing here writes to the database.
 */
function DemoBanner() {
  return (
    <div className="flex items-center gap-2 border-(--amber-11)/30 border-b bg-(--amber-3) px-4 py-2 text-(--amber-11) text-sm lg:px-6">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span>
        Demo data — nothing here is real and edits will not save.{" "}
        <Link href="/dashboard/listings/rates-availability" className="underline">
          Switch to your live rates
        </Link>
        .
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="font-medium">No room types yet</h2>
      <p className="max-w-sm text-muted-foreground text-sm">
        Add room types and rate plans to your property, and they will show up
        here for you to manage.
      </p>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <Skeleton className="h-9 w-full max-w-2xl" />
      <Skeleton className="h-[28rem] w-full" />
    </div>
  );
}
