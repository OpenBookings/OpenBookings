import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, CircleDashed, FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  blockers,
  nextStep,
  type EmptyAction,
  type EmptyVariant,
} from "@/lib/analytics/empty-state";
import type { ReadinessItem } from "@/lib/analytics/readiness";

const ICONS: Record<EmptyVariant, typeof CircleDashed> = {
  "not-live": CircleDashed,
  "no-bookings": CalendarClock,
  filtered: FilterX,
};

interface EmptyStateProps {
  variant: EmptyVariant;
  headline: string;
  body: ReactNode;
  /** The one button, when there is something the host can do. */
  action?: EmptyAction | null;
}

/** A small icon, two lines of text and at most one button. */
export function EmptyState({ variant, headline, body, action }: EmptyStateProps) {
  const Icon = ICONS[variant];
  return (
    <Empty className="gap-5 md:p-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{headline}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      {action ? (
        <EmptyContent>
          <Button asChild>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

/** Names the blocker, so a payout setup that stalled is not read as "nobody is booking". */
function notLiveBody(readiness: ReadinessItem[]): string {
  const open = new Set(blockers(readiness).map((item) => item.key));
  if (open.has("listing") && open.has("payments")) {
    return "Your listing isn't published and payments aren't set up, so guests can't book yet.";
  }
  if (open.has("payments")) {
    return "Payments aren't set up yet, so guests can't book. That is a setup step, not a lack of interest.";
  }
  return "Your listing isn't published yet, so guests can't find or book it.";
}

/**
 * For a host who has never had a booking: the page itself, every figure at
 * zero, behind a blur, with one message over it. The page underneath is inert:
 * it is there to show what is coming, not to be read or used.
 */
export function NeverBookedCover({
  variant,
  readiness,
  children,
}: {
  variant: "not-live" | "no-bookings";
  readiness: ReadinessItem[];
  children: ReactNode;
}) {
  const next = variant === "not-live" ? nextStep(readiness) : null;
  return (
    // Both children share one grid cell, so the cover is exactly as large as the page under it.
    <div className="grid min-w-0 flex-1 [&>*]:col-start-1 [&>*]:row-start-1">
      <div aria-hidden inert className="flex min-w-0 select-none flex-col gap-4 md:gap-6">
        {children}
      </div>
      {/* Reaches into the gap above and below: a blur that stops at the first line of text slices it. */}
      <div className="-my-4 z-10 flex justify-center bg-background/40 px-4 backdrop-blur-sm md:-my-6">
        <section className="mt-20 w-full max-w-md self-start rounded-xl border bg-card shadow-sm md:mt-22">
          <EmptyState
            variant={variant}
            headline="Got a booking? Your data will show up here!"
            body={
              variant === "not-live"
                ? notLiveBody(readiness)
                : "Revenue, occupancy and booking patterns fill in after your first reservation."
            }
            action={next ? { label: next.action, href: next.href } : null}
          />
        </section>
      </div>
    </div>
  );
}

/** For a host with bookings, none of them in the period on screen. */
export function FilteredPanel({ action }: { action: EmptyAction }) {
  return (
    <section className="rounded-xl border bg-card">
      <EmptyState
        variant="filtered"
        headline="No bookings in this period"
        body="Try a wider date range."
        action={action}
      />
    </section>
  );
}
