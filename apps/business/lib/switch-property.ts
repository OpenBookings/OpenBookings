"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setCurrentProperty } from "@openbookings/authz";
import { safeReturnTo, sectionIndex } from "@/lib/section-index";

/**
 * Switch the signed-in host's current hotel, then land on the section index of
 * the page they were on (a detail page of the old hotel means nothing for the
 * new one). The access check lives in setCurrentProperty; a hotel the user
 * cannot read returns { ok: false } and nothing is written or redirected.
 */
export async function switchProperty(propertyId: string, returnTo: string): Promise<{ ok: false }> {
  // Lazy: lib/auth reads the auth env at import time.
  const { getServerSession } = await import("@/lib/auth");
  const session = await getServerSession();
  const sessionId = session?.session?.id;
  if (!session || typeof sessionId !== "string" || !sessionId) return { ok: false };
  const switched = await setCurrentProperty({ userId: session.user.id, sessionId }, String(propertyId));
  if (!switched) return { ok: false };
  revalidatePath("/dashboard", "layout");
  redirect(sectionIndex(safeReturnTo(returnTo)));
}
