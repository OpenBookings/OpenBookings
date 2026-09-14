"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReservationsList } from "@/components/dashboard/reservations-list";
import { ReservationStatusBadge } from "@/components/dashboard/reservation-status";
import {
  ReservationDetailBody,
  ReservationDetailSkeleton,
  ReservationQuickActions,
} from "@/components/dashboard/reservation-detail-panel";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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

  const direction = isDesktop ? "right" : "bottom";

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <ReservationsList
          buckets={buckets}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>
      <Drawer
        // Vaul reads `direction` on mount, so remount when the breakpoint flips.
        key={direction}
        direction={direction}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DrawerContent
          className={[
            // Inset "floating" panel instead of a flush full-height sidebar.
            "data-[vaul-drawer-direction=right]:inset-y-2",
            "data-[vaul-drawer-direction=right]:right-2",
            "data-[vaul-drawer-direction=right]:h-auto",
            "data-[vaul-drawer-direction=right]:w-[22vw]",
            "data-[vaul-drawer-direction=right]:min-w-80",
            "data-[vaul-drawer-direction=right]:sm:max-w-md",
            "data-[vaul-drawer-direction=right]:overflow-hidden",
            "data-[vaul-drawer-direction=right]:rounded-lg",
            "data-[vaul-drawer-direction=right]:border",
            "data-[vaul-drawer-direction=right]:shadow-lg",
          ].join(" ")}
        >
          <DrawerHeader className="flex-row items-center justify-between gap-2 border-b">
            {loading ? (
              <Skeleton className="h-5 w-32" />
            ) : (
              <div className="flex items-center gap-2">
                <DrawerTitle className="text-sm">
                  {detail ? detail.id : selectedId}
                </DrawerTitle>
                {detail && <ReservationStatusBadge status={detail.status} />}
              </div>
            )}
            <DrawerDescription className="sr-only">
              Reservation details
            </DrawerDescription>
            <DrawerClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Close details"
              >
                <X />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto p-5">
            {loading ? (
              <ReservationDetailSkeleton />
            ) : !detail ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Reservation not found.
              </p>
            ) : (
              <ReservationDetailBody reservation={detail} />
            )}
          </div>
          {!loading && detail && (
            <DrawerFooter className="border-t">
              <ReservationQuickActions />
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
