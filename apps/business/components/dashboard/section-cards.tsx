import {
  IconCalendarClock,
  IconDoorEnter,
  IconDoorExit,
  IconUsers,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import type { ReservationBuckets } from "@/components/dashboard/mock-reservations";

function names(list: { guestName: string }[], none: string): string {
  if (list.length === 0) return none;
  if (list.length === 1) return list[0].guestName;
  return `${list[0].guestName} and ${list.length - 1} more`;
}

/**
 * The day at a glance: one raised strip with four figures, each with a line
 * that says who or how many. The spectrum hairline along the top is this
 * view's one bit of light; the tinted icon tiles carry each figure's state.
 */
export function SectionCards({ buckets }: { buckets: ReservationBuckets }) {
  const inHouseGuests = buckets.inHouse.reduce((sum, r) => sum + r.guests, 0);
  const rooms = buckets.inHouse.length;

  const cells = [
    {
      label: "Check-outs today",
      value: buckets.checkOuts.length,
      note: names(buckets.checkOuts, "Nobody leaves today"),
      icon: IconDoorExit,
      tone: "[--tone:var(--state-attention)]",
    },
    {
      label: "Check-ins today",
      value: buckets.checkIns.length,
      note: names(buckets.checkIns, "Nobody arrives today"),
      icon: IconDoorEnter,
      tone: "[--tone:var(--state-positive)]",
    },
    {
      label: "In house",
      value: inHouseGuests,
      note: rooms === 1 ? "guests in 1 room" : `guests in ${rooms} rooms`,
      icon: IconUsers,
      tone: "[--tone:var(--state-onsite)]",
    },
    {
      label: "Upcoming",
      value: buckets.upcoming.length,
      note: buckets.upcoming.length === 1 ? "arrival still to come" : "arrivals still to come",
      icon: IconCalendarClock,
      tone: "[--tone:var(--state-neutral)]",
    },
  ];

  return (
    <div className="px-4 lg:px-6">
      <div className="relative grid grid-cols-2 overflow-hidden rounded-xl border bg-card @5xl/main:grid-cols-4">
        <div aria-hidden className="spectrum-hairline absolute inset-x-[8%] top-0" />
        {cells.map((cell, i) => (
          <div
            key={cell.label}
            className={cn(
              "flex min-w-0 flex-col gap-2 px-5 pt-4 pb-5",
              cell.tone,
              i % 2 === 1 && "border-l",
              i >= 2 && "border-t @5xl/main:border-t-0",
              i === 2 && "@5xl/main:border-l",
            )}
          >
            <span className="flex items-center gap-2 text-muted-foreground text-sm">
              <span className="grid size-[26px] shrink-0 place-items-center rounded-md bg-[color-mix(in_oklch,var(--tone)_15%,transparent)] text-(--tone)">
                <cell.icon aria-hidden className="size-4" />
              </span>
              {cell.label}
            </span>
            <span className="font-semibold text-3xl text-[color-mix(in_oklch,var(--tone)_35%,var(--foreground))] tabular-nums leading-none">
              {cell.value}
            </span>
            <span className="truncate text-muted-foreground text-xs">{cell.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
