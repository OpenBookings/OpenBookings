import { Suspense } from "react";
import { ReservationsView } from "@/components/dashboard/reservations-view";
import {
  bucketReservations,
  mockReservations,
} from "@/components/dashboard/mock-reservations";

export default function ReservationsPage() {
  const buckets = bucketReservations(mockReservations);

  return (
    <Suspense>
      <ReservationsView buckets={buckets} />
    </Suspense>
  );
}
