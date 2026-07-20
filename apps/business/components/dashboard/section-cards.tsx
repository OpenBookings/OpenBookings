import {
  IconCalendarClock,
  IconDoorEnter,
  IconDoorExit,
  IconUsers,
} from "@tabler/icons-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ReservationBuckets } from "@/components/dashboard/mock-reservations";

export function SectionCards({ buckets }: { buckets: ReservationBuckets }) {
  const inHouseGuests = buckets.inHouse.reduce((sum, r) => sum + r.guests, 0);

  // Icon tints echo the reservation status hues: amber = needs handling
  // today, indigo = arriving/confirmed, green = on the property.
  const cards = [
    {
      label: "C/O's Today",
      value: buckets.checkOuts.length,
      icon: IconDoorExit,
      iconClass: "text-(--amber-11)/80",
    },
    {
      label: "C/I's Today",
      value: buckets.checkIns.length,
      icon: IconDoorEnter,
      iconClass: "text-(--accent-11)/80",
    },
    {
      label: "In-house",
      value: inHouseGuests,
      icon: IconUsers,
      iconClass: "text-(--green-11)/80",
    },
    {
      label: "Upcoming",
      value: buckets.upcoming.length,
      icon: IconCalendarClock,
      iconClass: "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {cards.map((card) => (
        <Card key={card.label} className="@container/card">
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              <card.icon className={`${card.iconClass} size-5 @[250px]/card:size-6`} />
              {card.value}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
