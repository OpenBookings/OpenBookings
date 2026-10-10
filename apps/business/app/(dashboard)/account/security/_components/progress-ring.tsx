const SIZE = 56;
const RADIUS = 23;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressRing({ done, total }: { done: number; total: number }) {
  const complete = done >= total;
  return (
    <div
      role="img"
      aria-label={`${done} of ${total} steps complete`}
      className="relative size-14 shrink-0"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={5} className="stroke-secondary" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={`${(done / total) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          className={
            (complete ? "stroke-(--green-11)" : "stroke-(--amber-11)") +
            " transition-[stroke-dasharray] duration-[400ms] ease-out motion-reduce:transition-none"
          }
        />
      </svg>
      <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold">
        {done}/{total}
      </span>
    </div>
  );
}
