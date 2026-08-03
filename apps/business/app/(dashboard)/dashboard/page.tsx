import { SectionCards } from "@/components/dashboard/section-cards";
import { SiteHeader } from "@/components/dashboard/site-header";
import { ReservationsTabs } from "@/components/dashboard/reservations-tabs";
import {
  bucketReservations,
  mockReservations,
} from "@/components/dashboard/mock-reservations";

export default function DashboardPage() {
  const buckets = bucketReservations(mockReservations);

  return (
    <>
      <SiteHeader title="Overview" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            <SectionCards buckets={buckets} />
            <ReservationsTabs buckets={buckets} />
          </div>
        </div>
      </div>
    </>
  );
}
