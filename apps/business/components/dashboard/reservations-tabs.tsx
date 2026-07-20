"use client";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReservationsTable } from "@/components/dashboard/reservations-table";
import type {
  MockReservation,
  ReservationBuckets,
} from "@/components/dashboard/mock-reservations";

export function ReservationsTabs({
  buckets,
  selectedId,
  onSelect,
}: {
  buckets: ReservationBuckets;
  selectedId?: string | null;
  onSelect?: (reservation: MockReservation) => void;
}) {
  const tabs = [
    {
      value: "upcoming",
      label: "Upcoming",
      reservations: buckets.upcoming,
      emptyMessage: "No upcoming reservations.",
    },
    {
      value: "check-ins",
      label: "Check-ins",
      reservations: buckets.checkIns,
      emptyMessage: "No check-ins today.",
    },
    {
      value: "check-outs",
      label: "Check-outs",
      reservations: buckets.checkOuts,
      emptyMessage: "No check-outs today.",
    },
    {
      value: "in-house",
      label: "In-house",
      reservations: buckets.inHouse,
      emptyMessage: "No guests currently in-house.",
    },
  ];

  return (
    <Tabs defaultValue="upcoming" className="flex flex-col gap-4 px-4 lg:px-6">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
            <Badge variant="secondary" className="ml-1.5 px-1.5">
              {tab.reservations.length}
            </Badge>
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <ReservationsTable
            reservations={tab.reservations}
            emptyMessage={tab.emptyMessage}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
