import { Ban, CircleSlash, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CellState, RatePlanStatus } from "../_lib/types";
import { cn } from "@/lib/utils";

/**
 * The four cell states, and the one place their appearance is defined.
 *
 * Every non-open state carries three independent signals — colour, an icon,
 * and a word — so the grid stays readable in greyscale and to anyone who
 * can't separate red from amber. Sold out additionally gets a hatch fill:
 * it is the state a host most needs to tell apart from Closed at a glance
 * ("we're full" and "I forgot to reopen this" want completely different
 * fixes), and a texture difference survives any colour deficiency.
 *
 * Each renders as a bar: a card-coloured pill carrying a thick coloured left
 * edge, so a run reads as one object spanning its dates rather than as a
 * block of fill that fights the grid it sits in.
 */
export const CELL_STATE_STYLE: Record<
  Exclude<CellState, "open">,
  { label: string; icon: LucideIcon; className: string; hatch: boolean }
> = {
  closed: {
    label: "Closed",
    icon: Ban,
    className:
      "border-(--red-5) [border-left-color:var(--red-9)] bg-(--red-3) text-(--red-9) hover:brightness-125",
    hatch: false,
  },
  sold_out: {
    label: "Sold out",
    icon: CircleSlash,
    className:
      "border-(--gray-6) [border-left-color:var(--gray-9)] bg-(--gray-5) text-(--gray-11) hover:brightness-125",
    hatch: true,
  },
  restricted: {
    label: "Restricted",
    icon: TriangleAlert,
    className:
      "border-(--amber-11)/25 [border-left-color:var(--amber-11)] bg-(--amber-3) text-(--amber-11) hover:brightness-125",
    hatch: false,
  },
};

/** Diagonal hatch, applied over the sold-out fill. */
export const HATCH_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.05) 4px, rgba(255,255,255,0.05) 8px)",
};

const STATUS_STYLE: Record<
  RatePlanStatus,
  { className: string; label: string }
> = {
  healthy: { className: "bg-(--green-11)", label: "All dates open" },
  attention: {
    className: "bg-(--amber-11)",
    label: "Some dates closed or restricted",
  },
  inactive: { className: "bg-(--red-9)", label: "No dates bookable" },
};

/**
 * Status dot on a rate plan label. The dot is never the only carrier of the
 * meaning — it has a title and an accessible label, and the cells it
 * summarises are right there on the same row.
 */
export function StatusDot({ status }: { status: RatePlanStatus }) {
  const { className, label } = STATUS_STYLE[status];
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", className)}
      title={label}
      role="img"
      aria-label={label}
    />
  );
}
