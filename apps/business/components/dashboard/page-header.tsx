import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Every console page opens the same way: a Gloock title, one plain sentence
 * that says what the page is for, and the page's main action on the right.
 * The serif appears here and nowhere else in the console.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-balance font-serif text-[28px] leading-[1.1] tracking-[-0.005em] sm:text-[30px]">
          {title}
        </h1>
        {description ? <p className="mt-1.5 text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A titled block inside a page: 15px semibold, optional line and action. */
export function SectionHeader({
  title,
  description,
  actions,
  as: Heading = "h2",
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <Heading className="font-semibold text-[15px] leading-snug">{title}</Heading>
        {description ? <p className="mt-0.5 text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** The small caps label above a group ("Guest", "Arriving tomorrow"). */
export function SectionLabel({
  as: Tag = "p",
  className,
  ...props
}: Omit<React.ComponentProps<"p">, "ref"> & { as?: "p" | "h3" | "h4" | "span" | "legend" }) {
  return (
    <Tag
      className={cn("font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.1em]", className)}
      {...props}
    />
  );
}
