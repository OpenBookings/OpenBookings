"use server";

import { loadBookingDelivery } from "@/app/(dashboard)/dashboard/listings/channel-manager/_lib/data";
import { getServerSession } from "@/lib/auth";
import { managedBy } from "@/lib/apps/managed";
import type { BookingDelivery } from "@/lib/apps/managed-view";
import { pageAccess } from "@/lib/page-access";

/**
 * The booking panel's SiteMinder status for one booking of the current hotel.
 * Null when the hotel is not connected to SiteMinder now, the viewer may not
 * open reservations there, or the app was never told about the booking.
 */
export async function bookingDeliveryAction(bookingId: string): Promise<BookingDelivery | null> {
  if (typeof bookingId !== "string") return null;
  const session = await getServerSession();
  if (!session) return null;
  const access = await pageAccess("reservations");
  if (access.level === "none" || !access.current) return null;
  const propertyId = access.current.propertyId;
  if (!(await managedBy(propertyId))) return null;
  const delivery = await loadBookingDelivery(bookingId, propertyId);
  return delivery ? { status: delivery.status, acknowledgedAt: delivery.acknowledgedAt } : null;
}
