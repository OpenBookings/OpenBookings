"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReservationsList } from "@/components/dashboard/reservations-list";
import {
  ReservationDetailBody,
  ReservationDetailPanel,
  ReservationDetailSkeleton,
  ReservationQuickActions,
} from "@/components/dashboard/reservation-detail-panel";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  mockReservations,
  type MockReservation,
  type ReservationBuckets,
} from "@/components/dashboard/mock-reservations";

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeToDesktopQuery(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function useIsDesktop() {
  return React.useSyncExternalStore(
    subscribeToDesktopQuery,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false
  );
}

// Simulated fetch over mock data; swap for the real API call later.
function fetchReservation(id: string): Promise<MockReservation | null> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(mockReservations.find((r) => r.id === id) ?? null);
    }, 600);
  });
}

export function ReservationsView({ buckets }: { buckets: ReservationBuckets }) {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Selection lives in the URL: /dashboard/bookings/reservations?id=RES-1041
  const selectedId = searchParams.get("id");

  const [fetched, setFetched] = React.useState<{
    id: string;
    reservation: MockReservation | null;
  } | null>(null);
  const detail = fetched?.id === selectedId ? fetched.reservation : null;
  const loading = selectedId !== null && fetched?.id !== selectedId;

  React.useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    fetchReservation(selectedId).then((reservation) => {
      if (cancelled) return;
      setFetched({ id: selectedId, reservation });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (id === null) {
      params.delete("id");
    } else {
      params.set("id", id);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  const handleSelect = (reservation: MockReservation) => {
    select(selectedId === reservation.id ? null : reservation.id);
  };

  const handleClose = () => select(null);

  return (
    <>
      <div className="flex min-h-0 flex-1 items-stretch lg:pr-6">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ReservationsList
            buckets={buckets}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        </div>
        <div className="hidden w-[22vw] max-w-96 min-w-72 shrink-0 lg:flex lg:min-h-0 lg:flex-col">
          <ReservationDetailPanel
            selectedId={selectedId}
            reservation={detail}
            loading={loading}
            onClose={handleClose}
          />
        </div>
      </div>
      {!isDesktop && (
        <Sheet
          open={selectedId !== null}
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        >
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>
                {detail ? detail.id : "Reservation details"}
              </SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto px-4 pb-4">
              {loading ? (
                <ReservationDetailSkeleton />
              ) : !detail ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  Reservation not found.
                </p>
              ) : (
                <div className="flex flex-col gap-6">
                  <ReservationDetailBody reservation={detail} />
                  <ReservationQuickActions />
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
