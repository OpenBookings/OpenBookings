"use client";

import * as React from "react";
import type { ManagedRooms } from "@/lib/apps/managed-view";

/**
 * Whether this hotel's rates come from SiteMinder, for the grid and its
 * detail sheet deep below the view: null when the hotel sets them itself.
 * Locking the edit controls is EditAccessProvider's job; this carries what
 * only a managed grid shows (unlinked rooms, "Set in SiteMinder").
 */
const AriManagedContext = React.createContext<ManagedRooms | null>(null);

export const AriManagedProvider = AriManagedContext.Provider;

export function useAriManaged(): ManagedRooms | null {
  return React.useContext(AriManagedContext);
}
