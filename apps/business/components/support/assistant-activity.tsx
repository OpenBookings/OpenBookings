"use client";

import { ThinkingOrb } from "thinking-orbs";
import { Button } from "@/components/ui/button";
import type { ActivityLine } from "@/lib/support/activity";
import { AI_COPY } from "@/lib/support/copy";

/**
 * The line where the next reply will appear. The orb (20 px preset, theme
 * auto) marks AI activity only; reduced motion and offscreen pausing are the
 * library's. If the orb ever fails, the label alone still says it all.
 */
export function AssistantActivity({
  line,
  onTalkToPerson,
}: {
  line: ActivityLine;
  onTalkToPerson?: () => void;
}) {
  // A polite live region whose text only changes with the state: announced
  // once per change, never per frame. The orb carries the same label.
  const label = line?.kind === "orb" ? line.label : line?.kind === "text" ? line.text : "";

  return (
    <>
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
      {line?.kind === "orb" ? (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <ThinkingOrb state={line.state} size={20} aria-label={line.label} className="shrink-0" />
          <span aria-hidden>{line.label}</span>
          {line.offerPerson && onTalkToPerson ? (
            <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={onTalkToPerson}>
              {AI_COPY.talkToPerson}
            </Button>
          ) : null}
        </div>
      ) : line?.kind === "text" ? (
        <p aria-hidden className="py-1 text-xs text-muted-foreground">
          {line.text}
        </p>
      ) : null}
    </>
  );
}
