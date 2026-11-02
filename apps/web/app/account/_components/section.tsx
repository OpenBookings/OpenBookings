import * as React from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PendingButton } from "./pending-button";

/**
 * The account pages' building blocks, ported from apps/business
 * (account/security/_components/security-sections.tsx) so both apps' account
 * pages read the same: a page header, then sections with a title, a one-line
 * helper, an optional action, and a card of rows.
 */

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header>
      <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">{title}</h1>
      {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
    </header>
  );
}

export function Section({
  id,
  title,
  helper,
  action,
  headingRef,
  footnote,
  children,
}: {
  id: string;
  title: string;
  helper?: string;
  action?: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
  footnote?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={id} ref={headingRef} tabIndex={-1} className="scroll-mt-24 text-base font-semibold outline-none">
            {title}
          </h2>
          {helper ? <p className="mt-1 text-sm text-muted-foreground">{helper}</p> : null}
        </div>
        {action}
      </div>
      {children}
      {footnote ? <p className="text-[13px] text-muted-foreground">{footnote}</p> : null}
    </section>
  );
}

export function RowList({ children }: { children: React.ReactNode }) {
  return <Card className="gap-0 divide-y overflow-hidden py-0">{children}</Card>;
}

export function Row({
  icon,
  name,
  chip,
  meta,
  actions,
}: {
  icon: React.ReactNode;
  name: React.ReactNode;
  chip?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{name}</span>
          {chip}
        </p>
        {meta ? <p className="mt-0.5 text-[13px] text-muted-foreground">{meta}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </li>
  );
}

export function SkeletonRows({ rows = 2 }: { rows?: number }) {
  return (
    <RowList>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-10 rounded-[10px]" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>
      ))}
    </RowList>
  );
}

export function LoadError({ what, onRetry, retrying }: { what: string; onRetry: () => void; retrying: boolean }) {
  return (
    <Card role="alert" className="flex-row flex-wrap items-center justify-between gap-4 px-5 py-4">
      <p className="text-sm text-muted-foreground">Your {what} could not be loaded.</p>
      <PendingButton variant="outline" pending={retrying} onClick={onRetry}>
        Retry
      </PendingButton>
    </Card>
  );
}

/** A centred empty state inside a card, for a list with nothing in it yet. */
export function EmptyCard({ icon, title, body, action }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="items-center gap-3 px-6 py-12 text-center">
      <span className="text-muted-foreground/70 [&_svg]:size-8">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {action}
    </Card>
  );
}
