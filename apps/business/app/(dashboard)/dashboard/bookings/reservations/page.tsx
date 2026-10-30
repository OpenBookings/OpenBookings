import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ReservationsView } from "@/components/dashboard/reservations-view";
import { bucketReservations } from "@/components/dashboard/reservation-types";
import { getServerSession } from "@/lib/auth";
import { loadHostReservations } from "@/lib/reservations/query";

export default async function ReservationsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const reservations = await loadHostReservations(session);

  return (
    <Suspense>
      <ReservationsView reservations={reservations} buckets={bucketReservations(reservations)} />
    </Suspense>
  );
}
