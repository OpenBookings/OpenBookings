"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Whether the viewer may change what a console page shows, for pages their
 * role at the current hotel can open but not edit (lib/page-access.ts). The
 * page sets it once around its edit surface; save, add and delete controls
 * inside read it and render disabled with the reason in a tooltip.
 *
 * Cosmetic only: every server action re-checks with userCan.
 */

type EditAccess = { canEdit: boolean; reason: string | null };

// Default "can edit" on purpose: this layer is cosmetic (server actions enforce), and
// surfaces outside a provider, such as onboarding's reuse of SectionForm, must stay editable.
const EditAccessContext = React.createContext<EditAccess>({ canEdit: true, reason: null });

export function viewOnlyReason(hotelName: string): string {
  return `Your role at ${hotelName} can view this but not change it.`;
}

export function EditAccessProvider({
  canEdit,
  hotelName,
  children,
}: {
  canEdit: boolean;
  /** The current hotel, for the tooltip. */
  hotelName: string | null | undefined;
  children: React.ReactNode;
}) {
  const value = React.useMemo<EditAccess>(
    () => ({ canEdit, reason: canEdit ? null : viewOnlyReason(hotelName ?? "this hotel") }),
    [canEdit, hotelName],
  );
  return <EditAccessContext.Provider value={value}>{children}</EditAccessContext.Provider>;
}

export function useEditAccess(): EditAccess {
  return React.useContext(EditAccessContext);
}

/**
 * Wraps one edit control. With edit access it renders the control as is;
 * without, the control is expected to be disabled (`disabled={!canEdit}`) and
 * gets the view-only tooltip. A disabled button fires no pointer events, so
 * the tooltip hangs on a focusable span around it.
 */
export function ViewOnlyHint({
  children,
  side,
  className,
}: {
  children: React.ReactNode;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
  className?: string;
}) {
  const { canEdit, reason } = useEditAccess();
  if (canEdit) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("inline-flex cursor-not-allowed rounded-lg", className)}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side}>{reason}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Disables every native control inside (inputs, selects, and the buttons
 * Radix controls are built from) without touching layout. Read-only help
 * inside one must not be a <button> (see InfoTip). A parent's space-y does
 * not reach through display:contents; pass it as className.
 */
export function EditFieldset({ children, className }: { children: React.ReactNode; className?: string }) {
  const { canEdit } = useEditAccess();
  return (
    <fieldset disabled={!canEdit} className={cn("contents", className)}>
      {children}
    </fieldset>
  );
}
