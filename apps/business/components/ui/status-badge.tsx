import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one way the console shows a state. Same mapping everywhere
 * (globals.css → "State"):
 *
 *   positive  — good, live, paid, confirmed
 *   attention — needs a decision
 *   onsite    — the guest is on the property
 *   stopped   — cancelled, closed, no-show
 *   adjusted  — changed by a pricing rule (the only lilac in the console)
 *   neutral   — done, nothing to do
 *
 * A tinted pill with a dot. The word always says the state too, so colour is
 * never the only signal.
 */
export type StatusTone = "positive" | "attention" | "onsite" | "stopped" | "adjusted" | "neutral";

const TONE: Record<StatusTone, string> = {
  positive: "[--tone:var(--state-positive)]",
  attention: "[--tone:var(--state-attention)]",
  onsite: "[--tone:var(--state-onsite)]",
  stopped: "[--tone:var(--state-stopped)]",
  adjusted: "[--tone:var(--state-adjusted)]",
  neutral: "[--tone:var(--state-neutral)]",
};

export function StatusBadge({
  tone,
  dot = true,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone: StatusTone; dot?: boolean }) {
  const tinted = tone !== "neutral";
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(
        "inline-flex h-[22px] w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 font-medium text-xs",
        TONE[tone],
        tinted
          ? "border-[color-mix(in_oklch,var(--tone)_30%,transparent)] bg-[color-mix(in_oklch,var(--tone)_15%,transparent)] text-[color-mix(in_oklch,var(--tone)_82%,white)]"
          : "border-border bg-accent text-foreground",
        !dot && "px-2.5",
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--tone)" /> : null}
      {children}
    </span>
  );
}

/** A count next to a tab or nav label: a quiet number, not a pill. */
export function CountBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="count-badge"
      className={cn("ml-1.5 font-medium text-muted-foreground text-xs tabular-nums", className)}
      {...props}
    />
  );
}
