"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EM_DASH } from "@/lib/analytics/format";
import type { Delta, StatValue, Widget } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";
import { useEmpty } from "./empty-context";

/**
 * Colour says which way the figure moved, not whether that is good. Metrics
 * where a rise is not good news arrive with a neutral tone and stay grey. The
 * label is always text, so the direction survives a greyscale print.
 */
export function DeltaChip({ delta }: { delta: Delta }) {
  const Icon = delta.direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs tabular-nums",
        delta.tone === "neutral" && "text-muted-foreground",
        delta.tone === "directional" && delta.direction === "up" && "text-(--green-11)",
        delta.tone === "directional" && delta.direction === "down" && "text-destructive",
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {delta.label}
    </span>
  );
}

interface StatProps {
  label: string;
  widget: Widget<StatValue>;
  format: (value: number | null) => string;
  /** The definition, behind the info icon. */
  info?: string;
  /** A second line under the figure, e.g. "38% of bookings". */
  note?: ReactNode;
  href?: string;
  hrefLabel?: string;
}

/**
 * One number: a large figure, a small label, a delta when there is one. No box.
 * Before the first booking it reads zero, with nothing beside it.
 */
export function Stat({ label, widget, format, info, note, href, hrefLabel }: StatProps) {
  const empty = useEmpty();
  const zeroed = empty !== null && empty.variant !== "filtered";
  const stat = widget.ok ? widget.value : null;
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-muted-foreground text-xs">
        {label}
        {info ? (
          <Tooltip>
            <TooltipTrigger
              className="transition-colors hover:text-foreground focus-visible:text-foreground"
              aria-label={`What ${label} means`}
            >
              <Info className="size-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{info}</TooltipContent>
          </Tooltip>
        ) : null}
      </dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-2xl tabular-nums tracking-tight">
          {zeroed ? format(0) : stat ? format(stat.value) : EM_DASH}
        </span>
        {stat?.delta && !zeroed ? <DeltaChip delta={stat.delta} /> : null}
      </dd>
      {note && !zeroed ? <p className="mt-0.5 text-muted-foreground text-xs">{note}</p> : null}
      {href && hrefLabel && !zeroed ? (
        <Link href={href} className="mt-0.5 inline-block text-xs underline underline-offset-4">
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <dl className="flex flex-wrap gap-x-10 gap-y-5 border-b px-4 pb-5 lg:px-6">{children}</dl>;
}
