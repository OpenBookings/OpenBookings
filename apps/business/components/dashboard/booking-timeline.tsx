import { cn } from "@/lib/utils";
import type { HostTimeline, TimelineStep, Tone } from "@/lib/reservations/timeline";

/** The spectrum stops (globals.css). Only the current state gets one. */
const TONE: Record<Tone, string> = {
  free: "var(--spectrum-mint)",
  fee: "var(--spectrum-amber)",
  stay: "var(--spectrum-sky)",
  noshow: "var(--spectrum-coral)",
  done: "var(--gray-11)",
  cancelled: "var(--gray-9)",
};

/**
 * What applies right now in one sentence, then the milestones top to bottom
 * with Today among them. Same design as the guest's booking page
 * (apps/web/app/bookings/[booking-ref]/_components/BookingTimeline.tsx),
 * on dashboard colours.
 */
export function BookingTimeline({ timeline }: { timeline: HostTimeline }) {
  const { headline, steps } = timeline;
  const color = TONE[headline.tone];

  return (
    <section aria-label="Timeline" className="flex flex-col gap-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color }}>
          {headline.eyebrow}
        </p>
        <p className="mt-1 text-[15px] leading-snug">{headline.sentence}</p>
      </div>

      <ol className="flex flex-col">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          return (
            <li
              key={step.key}
              aria-current={step.state === "today" ? "date" : undefined}
              className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3"
            >
              {/* Rail: dot, then the line down to the next step. */}
              <div className="flex flex-col items-center">
                <span className="flex h-5 items-center">
                  <Dot step={step} color={color} />
                </span>
                {next ? (
                  <span
                    aria-hidden
                    className={cn(
                      "flex-1",
                      next.state === "future" ? "w-0 border-l border-dashed border-(--gray-6)" : "w-px bg-(--gray-6)",
                    )}
                  />
                ) : null}
              </div>
              <div className={cn("min-w-0", next && "pb-4")}>
                <p className="flex flex-wrap items-baseline gap-x-2 leading-5">
                  <span
                    className={cn("text-sm", step.state === "past" ? "text-muted-foreground" : "font-medium")}
                    style={step.state === "today" ? { color } : undefined}
                  >
                    {step.label}
                  </span>
                  {step.state !== "today" ? (
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        step.state === "past" ? "text-(--gray-8)" : "text-muted-foreground",
                      )}
                    >
                      {step.date}
                      {step.time ? ` · ${step.time}` : ""}
                    </span>
                  ) : null}
                </p>
                {step.note ? <p className="text-xs text-muted-foreground">{step.note}</p> : null}
                {step.detail ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Dot({ step, color }: { step: TimelineStep; color: string }) {
  if (step.state === "today") {
    return (
      <span
        aria-hidden
        className="size-2.5 rounded-full"
        style={{
          background: color,
          boxShadow: `0 0 0 4px color-mix(in oklab, ${color} 20%, transparent), 0 0 12px ${color}`,
        }}
      />
    );
  }
  if (step.state === "past") {
    return (
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: step.tone ? TONE[step.tone] : "var(--gray-8)" }}
      />
    );
  }
  return <span aria-hidden className="size-2 rounded-full border border-(--gray-9)" />;
}
