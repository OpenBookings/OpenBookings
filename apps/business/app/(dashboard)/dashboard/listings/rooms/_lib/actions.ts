"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth";
import type { FormState } from "../../_lib/editor";
import * as m from "./mutations";

/**
 * The Rooms editor's server actions. Each one resolves the session and hands
 * off to mutations.ts, where the authorization and the writes live (and are
 * tested). Nothing here trusts an id from the client: mutations.ts checks
 * every one through @openbookings/authz.
 *
 * Every write revalidates R&A as well as the editor, because R&A reads the
 * same rooms and rate plans and would otherwise show the previous names,
 * units and on-sale state until its next navigation.
 */

const ROOMS = "/dashboard/listings/rooms";
const ARI = "/dashboard/listings/rates-availability";

async function session() {
  const s = await getServerSession();
  if (!s) throw new Error("Unauthenticated");
  return s;
}

function revalidate(roomId?: string) {
  revalidatePath(ROOMS);
  if (roomId) revalidatePath(`${ROOMS}/${roomId}`);
  revalidatePath(ARI);
}

export async function createRoom(propertyId: string) {
  const result = await m.createRoom(await session(), propertyId);
  if (result.ok) revalidate();
  return result;
}

export async function archiveRoom(roomId: string) {
  const result = await m.archiveRoom(await session(), roomId);
  if (result.ok) revalidate(roomId);
  return result;
}

export async function reorderRooms(propertyId: string, orderedIds: string[]) {
  const result = await m.reorderRooms(await session(), propertyId, orderedIds);
  if (result.ok) revalidate();
  return result;
}

export async function setRoomPublished(roomId: string, published: boolean) {
  const result = await m.setRoomPublished(await session(), roomId, published);
  if (result.ok) revalidate(roomId);
  return result;
}

export async function saveRoomIdentity(
  _prev: FormState<{ name: string; description: string }>,
  formData: FormData,
) {
  const state = await m.saveRoomIdentity(await session(), formData);
  if (state.success) revalidate(String(formData.get("roomId")));
  return state;
}

export async function saveRoomSpace(_prev: FormState<m.SpaceValues>, formData: FormData) {
  const state = await m.saveRoomSpace(await session(), formData);
  if (state.success) revalidate(String(formData.get("roomId")));
  return state;
}

export async function saveRoomAmenities(
  _prev: FormState<{ amenityKeys: string[]; featuredAmenityKeys: string[] }>,
  formData: FormData,
) {
  const state = await m.saveRoomAmenities(await session(), formData);
  if (state.success) revalidate(String(formData.get("roomId")));
  return state;
}

export async function saveRate(_prev: FormState<m.RateValues>, formData: FormData) {
  const state = await m.saveRate(await session(), formData);
  if (state.success) revalidate(state.values.roomId || undefined);
  return state;
}

export async function setRateActive(roomId: string, ratePlanId: string, active: boolean) {
  const result = await m.setRateActive(await session(), ratePlanId, active);
  if (result.ok) revalidate(roomId);
  return result;
}

export async function duplicateRate(roomId: string, ratePlanId: string) {
  const result = await m.duplicateRate(await session(), ratePlanId);
  if (result.ok) revalidate(roomId);
  return result;
}

export async function archiveRate(roomId: string, ratePlanId: string) {
  const result = await m.archiveRate(await session(), ratePlanId);
  if (result.ok) revalidate(roomId);
  return result;
}
