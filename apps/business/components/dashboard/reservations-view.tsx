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
  ReservationQuickActions,
} from "@/components/dashboard/reservation-detail-panel";
import { HostBookingActions } from "@/components/dashboard/host-booking-actions";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { ReservationBuckets, ReservationSummary } from "@/components/dashboard/reservation-types";
import type { HostReservation } from "@/lib/reservations/shape";

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

export function ReservationsView({
  reservations,
  buckets,
}: {
  reservations: HostReservation[];
  buckets: ReservationBuckets<HostReservation>;
}) {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Selection lives in the URL: /dashboard/bookings/reservations?id=RES-1041
  const selectedId = searchParams.get("id");

  // Loaded with the page and refreshed after every action (router.refresh).
  const detail = selectedId === null ? null : (reservations.find((r) => r.id === selectedId) ?? null);
  const loading = false;

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

  const handleSelect = (reservation: ReservationSummary) => {
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
                  {detail ? detail.reference : "Reservation"}
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
            {!detail ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Reservation not found.
              </p>
            ) : (
              <ReservationDetailBody reservation={detail} />
            )}
          </div>
          {!loading && detail && (
            <DrawerFooter className="gap-3 border-t">
              <HostBookingActions reservation={detail} />
              <ReservationQuickActions reservationId={detail.id} />
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
