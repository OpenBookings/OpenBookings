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
 *
 * The trigger is a span with the button role, not a <button>: the help sits
 * inside forms that a view-only role sees in a disabled fieldset, which
 * disables every <button> in it, and the help has to keep opening there.
 * Enter and Space open it like a button would.
 */
export function InfoTip({ label, children }: InfoTipProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label={`About ${label.toLowerCase()}`}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            setOpen((o) => !o);
          }}
          className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <InfoIcon className="size-3.5" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm">
        <div className="flex flex-col gap-2 [&_p]:text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
