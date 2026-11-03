"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReservationsList } from "@/components/dashboard/reservations-list";
import { ReservationStatusBadge } from "@/components/dashboard/reservation-status";
import { ReservationDetailBody } from "@/components/dashboard/reservation-detail-panel";
import { HostBookingActions } from "@/components/dashboard/host-booking-actions";
import { GetHelpButton } from "@/components/support/get-help-button";
import { breakGlass } from "@/lib/reservations/break-glass";
import { isUuid, shortBookingRef } from "@/lib/support/references";
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
import type { GuestContact, HostReservation } from "@/lib/reservations/shape";

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

  // Break the glass: the booking whose contact details are open, with the
  // details fetched for it and when. Any other booking (or closing the
  // panel) seals them again.
  const [opened, setOpened] = React.useState<{ id: string; contact: GuestContact; at: Date } | null>(null);
  const [breaking, setBreaking] = React.useState(false);
  const [glassError, setGlassError] = React.useState<{ id: string; message: string } | null>(null);
  const sealed = !detail || opened?.id !== detail.id;

  const handleBreakGlass = async () => {
    if (!detail) return;
    const id = detail.id;
    setBreaking(true);
    setGlassError(null);
    try {
      const result = await breakGlass(id);
      if ("contact" in result) setOpened({ id, contact: result.contact, at: new Date() });
      else setGlassError({ id, message: result.error });
    } catch {
      setGlassError({ id, message: "Something went wrong. Please try again." });
    } finally {
      setBreaking(false);
    }
  };

  const select = (id: string | null) => {
    // Every change of booking, closing included, seals the glass again.
    setOpened(null);
    setGlassError(null);
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
            "data-[vaul-drawer-direction=right]:w-[min(600px,calc(100vw-1rem))]",
            "data-[vaul-drawer-direction=right]:sm:max-w-none",
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
            <div className="flex items-center gap-1">
              {/* Links the booking (a UUID) so support sees which one. Hidden while support is off. */}
              {detail ? (
                <GetHelpButton
                  category="bookings"
                  iconOnly
                  variant="ghost"
                  size="icon-sm"
                  label="Get help with this booking"
                  linked={
                    isUuid(detail.id)
                      ? { type: "booking", id: detail.id, label: `Booking ${shortBookingRef(detail.id)}`, detail: "" }
                      : null
                  }
                />
              ) : null}
              <DrawerClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close details">
                  <X />
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto p-5 lg:p-6">
            {!detail ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Reservation not found.
              </p>
            ) : (
              <ReservationDetailBody
                reservation={detail}
                seal={{
                  opened: sealed ? null : { contact: opened!.contact, at: opened!.at },
                  busy: breaking,
                  error: glassError?.id === detail.id ? glassError.message : null,
                  onBreak: handleBreakGlass,
                }}
              />
            )}
          </div>
          {!loading && detail && (
            <DrawerFooter className="border-t px-5 py-3">
              <HostBookingActions reservation={detail} />
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
