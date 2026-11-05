"use server";

import { revalidatePath } from "next/cache";
import { withTransaction } from "@openbookings/db";
import {
  forceCancelRooms,
  forceClearMarkers,
  forceDeleteRefund,
  forceRefundStatus,
  forceStatus,
  forceUncancelRooms,
  type ForcedResult,
} from "./forced-edits";
import { requireSuperAdmin } from "./super-admin";

async function run(bookingId: string, fn: (tx: import("pg").PoolClient) => Promise<ForcedResult>) {
  requireSuperAdmin();
  const result = await withTransaction(fn);
  revalidatePath(`/bookings/${bookingId}`);
  return result;
}

export async function adminForceStatus(i: Parameters<typeof forceStatus>[1]) {
  return run(i.bookingId, (tx) => forceStatus(tx, i));
}
export async function adminForceUncancelRooms(i: Parameters<typeof forceUncancelRooms>[1]) {
  return run(i.bookingId, (tx) => forceUncancelRooms(tx, i));
}
export async function adminForceCancelRooms(i: Parameters<typeof forceCancelRooms>[1]) {
  return run(i.bookingId, (tx) => forceCancelRooms(tx, i));
}
export async function adminForceDeleteRefund(i: Parameters<typeof forceDeleteRefund>[1]) {
  return run(i.bookingId, (tx) => forceDeleteRefund(tx, i));
}
export async function adminForceRefundStatus(i: Parameters<typeof forceRefundStatus>[1]) {
  return run(i.bookingId, (tx) => forceRefundStatus(tx, i));
}
export async function adminForceClearMarkers(i: Parameters<typeof forceClearMarkers>[1]) {
  return run(i.bookingId, (tx) => forceClearMarkers(tx, i));
}
