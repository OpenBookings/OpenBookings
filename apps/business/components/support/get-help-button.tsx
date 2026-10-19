"use client";

import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LinkOption } from "@/lib/support/types";
import { useOptionalSupport } from "./support-provider";

/**
 * Contextual "Get help" (a booking, a listing): opens the intake with the
 * category preset and the item already linked, so the host only adds a
 * message. Renders nothing while support is switched off.
 */
export function GetHelpButton({
  category,
  linked,
  label = "Get help",
  variant = "outline",
  size = "sm",
  iconOnly = false,
}: {
  category: string;
  linked?: LinkOption | null;
  label?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "xs" | "icon" | "icon-sm";
  iconOnly?: boolean;
}) {
  const support = useOptionalSupport();
  if (!support) return null;
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-label={iconOnly ? label : undefined}
      onClick={() =>
        support.openPanel({
          newTicket: { category, linked: linked ?? null, locked: Boolean(linked) },
        })
      }
    >
      <LifeBuoy />
      {iconOnly ? null : label}
    </Button>
  );
}
