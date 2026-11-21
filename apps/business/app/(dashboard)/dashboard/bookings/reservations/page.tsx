import { PageHold } from "@/components/dashboard/page-loaders";
import { PageHeader } from "@/components/dashboard/page-header";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ReservationsView } from "@/components/dashboard/reservations-view";
import { bucketReservations } from "@/components/dashboard/reservation-types";
import { getServerSession } from "@/lib/auth";
import { getCurrentProperty } from "@/lib/current-property";
import { loadHostReservations } from "@/lib/reservations/query";

export default async function ReservationsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const current = await getCurrentProperty();
  const reservations = await loadHostReservations(session, current?.propertyId ?? null);

  return (
    <PageHold id="reservations" fill>
      <PageHeader
        title="Reservations"
        description="See who arrives, who leaves and who is staying with you."
        className="shrink-0 px-4 pb-4 md:pb-6 lg:px-6"
      />
      <Suspense>
        <ReservationsView reservations={reservations} buckets={bucketReservations(reservations)} />
      </Suspense>
    </PageHold>
  );
}
