"use client";

import * as React from "react";
import { InfoIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface InfoTipProps {
  /** What the tip explains, for the button's accessible name. */
  label: string;
  children: React.ReactNode;
}

/**
 * The "i" next to a field label. A popover rather than a tooltip: the help runs
 * to a few sentences, and a tooltip never opens on a touch screen.
 */
export function InfoTip({ label, children }: InfoTipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label.toLowerCase()}`}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm">
        <div className="flex flex-col gap-2 [&_p]:text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
