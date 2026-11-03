"use client";

import * as React from "react";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Where "Learn more" leads. TBD: point this at the privacy explainer once it
 * is written.
 */
export const BREAK_GLASS_LEARN_MORE_URL = "https://docs.openbookings.co/privacy/break-the-glass";

/**
 * Frosted glass over details that hold guest data. What sits underneath is
 * only a blurred stand-in: the sensitive parts are fetched from the server
 * when the glass is broken (and that is logged), never shipped beforehand.
 */
export function BreakTheGlass({
  sealed,
  busy,
  error,
  onBreak,
  children,
}: {
  sealed: boolean;
  busy: boolean;
  error: string | null;
  onBreak: () => void;
  children: React.ReactNode;
}) {
  if (!sealed) return <>{children}</>;
  return (
    <div className="relative min-h-80">
      {/* Out of reach while sealed: not focusable, not read out, not selectable. */}
      <div inert aria-hidden className="pointer-events-none select-none blur-md">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/40 p-4 backdrop-blur-xl">
        <div
          role="group"
          aria-labelledby="break-glass-title"
          className="flex max-w-xs flex-col items-center gap-3 rounded-lg border bg-background/80 p-5 text-center shadow-sm"
        >
          <ShieldAlert className="size-6 text-muted-foreground" aria-hidden />
          <h3 id="break-glass-title" className="font-medium">
            Break the glass
          </h3>
          <p className="text-sm text-muted-foreground">
            In terms of privacy, please be careful with what you view, when and for what. Opening these details
            is recorded.
          </p>
          <Button size="sm" onClick={onBreak} disabled={busy}>
            {busy ? <Spinner /> : null} Break the glass
          </Button>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <a
            href={BREAK_GLASS_LEARN_MORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Learn more <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}
