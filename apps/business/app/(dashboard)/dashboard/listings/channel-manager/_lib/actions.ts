"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth";
import { managedBy } from "@/lib/apps/managed";
import type { BookingDelivery } from "@/lib/apps/managed-view";
import { pageAccess } from "@/lib/page-access";
import { purgePropertyPage } from "@/lib/purge-property-page";
import {
  connectChannelManager as connect,
  disconnectChannelManager as disconnect,
  type ChannelManagerResult,
} from "./connect";
import { loadBookingDelivery } from "./data";

/**
 * Server actions behind the Channel manager page. The work is in connect.ts;
 * these add the session and, after a change, refresh every page that shows
 * whether the hotel is managed, and drop the guest listing page's cached copy
 * (it carries the `managed` flag for up to an hour otherwise).
 */

async function requireSession() {
  const session = await getServerSession();
  if (!session) throw new Error("Not signed in");
  return session;
}

async function afterChange(propertyId: string, result: ChannelManagerResult): Promise<ChannelManagerResult> {
  if (result.ok) {
    revalidatePath("/dashboard/listings", "layout");
    revalidatePath("/dashboard/bookings", "layout");
    await purgePropertyPage({ propertyId });
  }
  return result;
}

export async function connectChannelManager(input: {
  propertyId: string;
  sendUpcoming: boolean;
}): Promise<ChannelManagerResult> {
  return afterChange(input.propertyId, await connect(await requireSession(), input));
}

export async function disconnectChannelManager(input: { propertyId: string }): Promise<ChannelManagerResult> {
  return afterChange(input.propertyId, await disconnect(await requireSession(), input));
}

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
