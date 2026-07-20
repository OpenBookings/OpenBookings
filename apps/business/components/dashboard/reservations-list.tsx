"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReservationsTable } from "@/components/dashboard/reservations-table";
import type {
  MockReservation,
  ReservationBuckets,
} from "@/components/dashboard/mock-reservations";

const BUCKETS = [
  {
    value: "upcoming",
    label: "Upcoming",
    emptyMessage: "No upcoming reservations.",
  },
  {
    value: "check-ins",
    label: "Check-ins",
    emptyMessage: "No check-ins today.",
  },
  {
    value: "check-outs",
    label: "Check-outs",
    emptyMessage: "No check-outs today.",
  },
  {
    value: "in-house",
    label: "In-house",
    emptyMessage: "No guests currently in-house.",
  },
] as const;

type BucketValue = (typeof BUCKETS)[number]["value"];

const bucketReservationsByValue: Record<
  BucketValue,
  (buckets: ReservationBuckets) => MockReservation[]
> = {
  upcoming: (b) => b.upcoming,
  "check-ins": (b) => b.checkIns,
  "check-outs": (b) => b.checkOuts,
  "in-house": (b) => b.inHouse,
};

export function ReservationsList({
  buckets,
  selectedId,
  onSelect,
}: {
  buckets: ReservationBuckets;
  selectedId?: string | null;
  onSelect?: (reservation: MockReservation) => void;
}) {
  const [bucket, setBucket] = React.useState<BucketValue>("upcoming");
  const active = BUCKETS.find((b) => b.value === bucket) ?? BUCKETS[0];
  const reservations = bucketReservationsByValue[active.value](buckets);

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-fit">
            {active.label}
            <span className="text-muted-foreground tabular-nums">
              {reservations.length}
            </span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuRadioGroup
            value={bucket}
            onValueChange={(value) => setBucket(value as BucketValue)}
          >
            {BUCKETS.map((item) => (
              <DropdownMenuRadioItem key={item.value} value={item.value}>
                {item.label}
                <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                  {bucketReservationsByValue[item.value](buckets).length}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReservationsTable
        reservations={reservations}
        emptyMessage={active.emptyMessage}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </div>
  );
}
