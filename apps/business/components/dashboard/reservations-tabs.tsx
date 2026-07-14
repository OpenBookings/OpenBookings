import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  MockReservation,
  MockReservationStatus,
  ReservationBuckets,
} from "@/components/dashboard/mock-reservations";

const statusLabels: Record<MockReservationStatus, string> = {
  confirmed: "Confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  pending: "Pending",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

const currencyFormatter = new Intl.NumberFormat("en-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function ReservationsTable({
  reservations,
  emptyMessage,
}: {
  reservations: MockReservation[];
  emptyMessage: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead>Reservation</TableHead>
            <TableHead>Guest</TableHead>
            <TableHead>Room</TableHead>
            <TableHead>Check-in</TableHead>
            <TableHead>Check-out</TableHead>
            <TableHead className="text-right">Guests</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reservations.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="text-muted-foreground h-24 text-center"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            reservations.map((reservation) => (
              <TableRow key={reservation.id}>
                <TableCell className="font-medium">{reservation.id}</TableCell>
                <TableCell>{reservation.guestName}</TableCell>
                <TableCell>{reservation.roomName}</TableCell>
                <TableCell>
                  {dateFormatter.format(new Date(reservation.checkInDate))}
                </TableCell>
                <TableCell>
                  {dateFormatter.format(new Date(reservation.checkOutDate))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {reservation.guests}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="text-muted-foreground px-1.5"
                  >
                    {statusLabels[reservation.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {currencyFormatter.format(reservation.totalAmount)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function ReservationsTabs({ buckets }: { buckets: ReservationBuckets }) {
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
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
