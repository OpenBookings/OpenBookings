"use client";

import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SectionStatus } from "../_lib/editor";

interface SectionRailProps<S extends string> {
  /** The sections in rail order, with their labels. */
  sections: readonly { id: S; label: string }[];
  statuses: Record<S, SectionStatus>;
  active: S;
  completed: number;
  onSelect: (section: S) => void;
  publishSlot: React.ReactNode;
}

/**
 * The rail is not decoration. It answers the question a host actually has on
 * this screen — what on my page is still missing — and the same statuses gate
 * the publish switch below it.
 */
export function SectionRail<S extends string>({
  sections,
  statuses,
  active,
  completed,
  onSelect,
  publishSlot,
}: SectionRailProps<S>) {
  return (
    <nav
      aria-label="Listing sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-b p-3 md:w-56 md:flex-col md:overflow-visible md:border-r md:border-b-0"
    >
      {sections.map(({ id, label }) => {
        const status = statuses[id];
        const isActive = id === active;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <span className="truncate">{label}</span>
                {status.complete ? (
                  <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Complete" />
                ) : (
                  <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-label="Incomplete" />
                )}
              </button>
            </TooltipTrigger>
            {!status.complete && (
              <TooltipContent side="right">
                <p className="font-medium">Still needed</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {status.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </TooltipContent>
            )}
          </Tooltip>
        );
      })}

      <div className="hidden md:mt-4 md:flex md:flex-col md:gap-3 md:border-t md:pt-4">
        <p className="px-3 text-muted-foreground text-xs tabular-nums">
          {completed} of {sections.length} sections done
        </p>
        <div className="px-3">{publishSlot}</div>
      </div>
    </nav>
  );
}
