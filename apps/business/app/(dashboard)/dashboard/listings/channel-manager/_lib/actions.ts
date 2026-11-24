"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth";
import { purgePropertyPage } from "@/lib/purge-property-page";
import {
  connectChannelManager as connect,
  disconnectChannelManager as disconnect,
  type ChannelManagerResult,
} from "./connect";

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
