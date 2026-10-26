/** Placeholder in the poster's 2:3 frame, with bars where the real content sits. No animation. */
export function StayPosterSkeleton() {
  return (
    <div
      aria-hidden
      className="flex aspect-[2/3] flex-col justify-end gap-2.5 rounded-poster bg-poster-skeleton p-5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]"
    >
      <div className="h-2.5 w-[58%] rounded bg-white/7" />
      <div className="h-[26px] w-[80%] rounded-md bg-white/9" />
      <div className="h-3 w-[70%] rounded bg-white/6" />
      <div className="mt-1.5 h-px bg-white/8" />
      <div className="mt-1 flex items-end justify-between">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-[90px] rounded-md bg-white/9" />
          <div className="h-2.5 w-[140px] rounded bg-white/6" />
        </div>
        <div className="h-11 w-[72px] rounded-md bg-white/9" />
      </div>
    </div>
  );
}
