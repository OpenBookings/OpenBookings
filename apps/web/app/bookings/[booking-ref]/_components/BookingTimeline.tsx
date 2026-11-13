import { cn } from '@/lib/utils';
import type { Step, Timeline, Tone } from '../_lib/timeline';

/** The spectrum stops (globals.css). Only the current state gets one. */
const TONE: Record<Tone, string> = {
  free: 'var(--spectrum-mint)',
  fee: 'var(--spectrum-amber)',
  stay: 'var(--spectrum-sky)',
  noshow: 'var(--spectrum-coral)',
  done: 'rgb(255 255 255 / 0.7)',
  cancelled: 'rgb(255 255 255 / 0.5)',
};

/**
 * What applies right now in one sentence, then the milestones top to bottom
 * with Today among them. Each upcoming milestone says what changes there, so
 * the policy reads as a story instead of a table.
 */
export function BookingTimeline({ timeline }: { timeline: Pick<Timeline, 'headline' | 'steps'> }) {
  const { headline, steps } = timeline;
  const color = TONE[headline.tone];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color }}>
          {headline.eyebrow}
        </p>
        <p className="mt-1.5 text-[17px] leading-snug text-white">{headline.sentence}</p>
      </div>

      <ol aria-label="Timeline" className="flex flex-col">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          return (
            <li key={step.key} aria-current={step.state === 'today' ? 'date' : undefined} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3.5">
              {/* Rail: dot, then the line down to the next step. */}
              <div className="flex flex-col items-center">
                <span className="flex h-5 items-center">
                  <Dot step={step} color={color} />
                </span>
                {next ? (
                  <span
                    aria-hidden
                    className={cn('flex-1', next.state === 'future' ? 'w-0 border-l border-dashed border-white/25' : 'w-px bg-white/25')}
                  />
                ) : null}
              </div>
              <div className={cn('min-w-0', next && 'pb-5')}>
                <p className="flex flex-wrap items-baseline gap-x-2 leading-5">
                  <span
                    className={cn(
                      'text-sm',
                      step.state === 'past' ? 'text-white/45' : 'font-medium text-white',
                    )}
                    style={step.state === 'today' ? { color } : undefined}
                  >
                    {step.label}
                  </span>
                  {step.state !== 'today' ? (
                    <span className={cn('text-[13px] tabular-nums', step.state === 'past' ? 'text-white/35' : 'text-white/60')}>
                      {step.date}
                      {step.time ? ` · ${step.time}` : ''}
                    </span>
                  ) : null}
                </p>
                {step.note ? <p className="text-[13px] text-white/45">{step.note}</p> : null}
                {step.detail ? <p className="mt-1 text-[13px] leading-relaxed text-white/55">{step.detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Dot({ step, color }: { step: Step; color: string }) {
  if (step.state === 'today') {
    return (
      <span
        aria-hidden
        className="size-3 rounded-full"
        style={{ background: color, boxShadow: `0 0 0 4px color-mix(in oklab, ${color} 20%, transparent), 0 0 14px ${color}` }}
      />
    );
  }
  if (step.state === 'past') {
    return (
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: step.tone ? TONE[step.tone] : 'rgb(255 255 255 / 0.4)' }}
      />
    );
  }
  return <span aria-hidden className="size-2 rounded-full border border-white/50" />;
}
