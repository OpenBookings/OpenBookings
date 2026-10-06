"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StepperProps {
  id: string;
  /** Posted through a hidden input, which is what the server action reads. */
  name: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Accessible name, e.g. "King beds". The visible label sits beside it. */
  label: string;
}

/**
 * A minus / count / plus control for small counts — beds and guests — where
 * typing a number is slower than tapping. The count is a spinbutton, so arrow
 * keys, Home and End work for keyboard users as well as the two buttons.
 *
 * React writing the hidden input fires no input event, so the form's own
 * onChange never sees a change: callers mark the form dirty in `onChange`.
 */
export function Stepper({ id, name, value, min, max, onChange, disabled, invalid, label }: StepperProps) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));

  return (
    <div className="flex items-center gap-1">
      <input type="hidden" name={name} value={value} />
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={disabled || value <= min}
        onClick={() => set(value - 1)}
      >
        <MinusIcon />
      </Button>
      <span
        id={id}
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        onKeyDown={(e) => {
          if (disabled) return;
          const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
          if (step) {
            e.preventDefault();
            set(value + step);
          } else if (e.key === "Home") {
            e.preventDefault();
            set(min);
          } else if (e.key === "End") {
            e.preventDefault();
            set(max);
          }
        }}
        className={cn(
          "w-8 rounded-sm text-center text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          value === 0 && "text-muted-foreground",
          invalid && "text-destructive",
        )}
      >
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={disabled || value >= max}
        onClick={() => set(value + 1)}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}
