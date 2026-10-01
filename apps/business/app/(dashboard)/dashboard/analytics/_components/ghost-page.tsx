import type { GhostFrame, PageMeta } from "@/lib/analytics/pages";
import type { ReadinessItem } from "@/lib/analytics/readiness";
import { ReadinessCard } from "./readiness-card";

/** An empty frame of the right kind. Every slot is the same height: no shape implies a value. */
function GhostVisual({ kind }: { kind: GhostFrame["kind"] }) {
  if (kind === "table") {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-4 rounded-sm border border-dashed" />
        ))}
      </div>
    );
  }
  if (kind === "strip") {
    return (
      <div className="flex gap-1">
        {Array.from({ length: 30 }, (_, day) => (
          <div key={day} className="h-10 flex-1 rounded-[1px] border border-dashed" />
        ))}
      </div>
    );
  }
  if (kind === "bars") {
    return (
      <div className="flex h-28 items-end gap-3 border-b border-dashed">
        {[0, 1, 2, 3, 4].map((bar) => (
          <div key={bar} className="h-3/5 flex-1 border border-b-0 border-dashed" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-28 gap-2">
      <div className="flex flex-col justify-between text-[10px] text-muted-foreground">
        <span>High</span>
        <span>0</span>
      </div>
      <div className="flex-1 border-b border-l border-dashed" />
    </div>
  );
}

/**
 * For a host who has never had a booking: the page's real layout as a ghost,
 * with one message card over it. Static, faint and dashed, so it cannot be
 * mistaken for loading. One component for every page; only `meta.ghost` differs.
 */
export function GhostPage({
  meta,
  readiness,
  demoHref,
}: {
  meta: PageMeta;
  readiness: ReadinessItem[];
  demoHref: string;
}) {
  return (
    // Both children share one grid cell, so the container is as tall as the taller of the two.
    <div className="grid min-w-0 px-4 lg:px-6 [&>*]:col-start-1 [&>*]:row-start-1">
      <div aria-hidden className="pointer-events-none min-w-0 select-none opacity-40">
        <dl className="flex flex-wrap gap-x-10 gap-y-5 border-b border-dashed pb-5">
          {meta.ghost.stats.map((label) => (
            <div key={label}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="mt-1 font-semibold text-2xl">–</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 grid gap-4 @4xl/main:grid-cols-2">
          {meta.ghost.frames.map((frame) => (
            <div key={frame.title} className="min-w-0 rounded-lg border border-dashed p-4">
              <p className="font-medium text-sm">{frame.title}</p>
              <p className="text-muted-foreground text-xs">{frame.caption}</p>
              <div className="mt-4">
                <GhostVisual kind={frame.kind} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="z-10 mt-20 w-full max-w-xl self-start justify-self-center">
        <ReadinessCard readiness={readiness} demoHref={demoHref} />
      </div>
    </div>
  );
}
