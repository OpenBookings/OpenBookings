import { Ban, CircleSlash, Lock, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CellState, RatePlanStatus } from "../_lib/types";
import { cn } from "@/lib/utils";

/**
 * The non-open cell states, and the one place their appearance is defined.
 *
 * Every one carries three independent signals — colour, an icon, and a word —
 * so the grid stays readable in greyscale and to anyone who can't separate red
 * from amber.
 *
 * The hatch sits on Room closed rather than Sold out. Those two are the pair a
 * colour alone cannot separate, since both are grey, and they are also the
 * pair a host most needs to tell apart: "we're full" and "somebody shut this
 * room" want completely different responses, and only one of them has a
 * booking behind it. Sold out and Closed differ in hue as well as icon and
 * word, so the texture is spent where it buys the most.
 */
export const CELL_STATE_STYLE: Record<
  Exclude<CellState, "open">,
  { label: string; icon: LucideIcon; className: string; hatch: boolean }
> = {
  // Named for the cause rather than the effect: "Closed" here would send a
  // host to the rate plan, which is not where the switch is.
  room_closed: {
    label: "Room type closed",
    icon: Lock,
    className:
      "border-(--ari-border-strong) bg-(--ari-cell) text-(--ari-soldout-fg)",
    hatch: true,
  },
  closed: {
    label: "Stop-sell",
    icon: Ban,
    className:
      "border-(--ari-stopsell-border) bg-(--ari-stopsell-bg) text-(--ari-stopsell-fg)",
    hatch: false,
  },
  sold_out: {
    label: "Sold out",
    icon: CircleSlash,
    className:
      "border-(--ari-border) bg-(--ari-cell) text-(--ari-soldout-fg)",
    hatch: false,
  },
  restricted: {
    label: "Restricted",
    icon: TriangleAlert,
    className:
      "border-(--ari-restricted-bg) bg-(--ari-restricted-bg) text-(--ari-restricted-fg)",
    hatch: false,
  },
};

/** Diagonal hatch, applied over a closed room type. */
export const HATCH_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--ari-closed-hatch-a) 0 6px, var(--ari-closed-hatch-b) 6px 12px)",
};

/**
 * The chip under a price.
 *
 * One slot, so the variants are ranked by what a host can least afford to
 * miss. Unpublished outranks everything: the restriction is already saved and
 * will still be there tomorrow, whereas an edit nobody has published yet is
 * the one thing that vanishes if they walk away.
 */
export type ChipTone =
  | "unsaved"
  | "restricted"
  | "adjusted"
  | "sold_out"
  | "neutral";

const CHIP_TONE: Record<ChipTone, string> = {
  unsaved: "bg-primary text-primary-foreground",
  restricted: "bg-(--ari-restricted-bg) text-(--ari-restricted-fg)",
  adjusted: "bg-(--ari-adjusted-bg) text-(--ari-adjusted-fg)",
  sold_out: "bg-(--ari-soldout-chip) text-(--ari-soldout-fg)",
  neutral: "bg-(--gray-a5) text-muted-foreground",
};

export function Chip({
  tone,
  children,
  className,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "max-w-full truncate rounded-full px-1.5 py-px text-[10px] leading-[1.4]",
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Refundable / Non-refundable, on the rate plan rail. */
export function PolicyTag({ refundable }: { refundable: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-px text-[10px] leading-[1.4]",
        refundable
          ? "bg-(--ari-bookable-bg) text-(--ari-bookable-fg)"
          : "bg-(--gray-a5) text-muted-foreground",
      )}
    >
      {refundable ? "Refundable" : "Non-refundable"}
    </span>
  );
}

const STATUS_STYLE: Record<
  RatePlanStatus,
  { className: string; label: string }
> = {
  healthy: { className: "bg-(--ari-avail-ok)", label: "All dates open" },
  attention: {
    className: "bg-(--ari-restricted-fg)",
    label: "Some dates closed or restricted",
  },
  inactive: { className: "bg-(--ari-stopsell-fg)", label: "No dates bookable" },
};

/**
 * Status dot on a rate plan label. The dot is never the only carrier of the
 * meaning — it has a title and an accessible label, and the cells it
 * summarises are right there on the same row.
 */
export function StatusDot({ status }: { status: RatePlanStatus }) {
  const { className, label } = STATUS_STYLE[status];
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", className)}
      title={label}
      role="img"
      aria-label={label}
    />
  );
}

/**
 * How far above the legend the grid starts dissolving.
 *
 * Long enough that a row fades out rather than meeting a hard edge, short
 * enough that it never reaches the row a host is actually reading.
 */
const LEGEND_FADE = "4rem";

/**
 * A progressive blur, not a single frosted panel.
 *
 * One backdrop layer switches blur on at a line, and a line drawn across a
 * grid of numbers reads as a UI edge — as if the rows below it were a
 * different surface. Four layers, each masked to a shorter band at the
 * bottom, accumulate instead: the grid gets quietly less legible the closer
 * it comes to the legend, which is exactly the message. Percentages are of
 * the faded strip, measured from its bottom.
 */
const FADE_LAYERS = [
  { blur: "1px", solid: "55%", clear: "100%" },
  { blur: "2px", solid: "35%", clear: "75%" },
  { blur: "4px", solid: "20%", clear: "50%" },
  { blur: "8px", solid: "8%", clear: "30%" },
];

/**
 * The key to the grid's vocabulary.
 *
 * Worth the space because this screen encodes a lot into small marks, and a
 * host meets most of them for the first time on a date they are trying to fix.
 * Each entry renders the real mark rather than describing it, so the legend
 * cannot drift from the grid the way a written key would.
 *
 * Pinned to the bottom of the grid rather than parked below it: a host scrolls
 * this screen constantly, and a key that leaves the viewport is a key they
 * have to go looking for at the moment they need it. It overlays the rows, so
 * the grid keeps the height instead of paying for the legend twice, and the
 * blur above it is what makes that survivable — see FADE_LAYERS. Nothing here
 * takes the pointer, so wheel and click still reach the cells underneath.
 *
 * `ref` is how the grid learns the height to pad its scroll area with: the
 * legend wraps to a second line on narrower screens, and a hard-coded padding
 * would either strand the last row under the legend or leave a gap below it.
 */
export function GridLegend({ ref }: { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0"
        style={{ height: `calc(100% + ${LEGEND_FADE})` }}
      >
        {FADE_LAYERS.map(({ blur, solid, clear }) => {
          const mask = `linear-gradient(to top, #000 0%, #000 ${solid}, transparent ${clear})`;
          return (
            <span
              key={blur}
              className="absolute inset-0 block"
              style={{
                backdropFilter: `blur(${blur})`,
                WebkitBackdropFilter: `blur(${blur})`,
                maskImage: mask,
                WebkitMaskImage: mask,
              }}
            />
          );
        })}
        {/*
          Blur alone keeps shapes and contrast, and a price behind the word it
          explains is still a price. The tint is what buys the legend its
          contrast back.
        */}
        <span
          className="absolute inset-0 block"
          style={{
            backgroundImage:
              "linear-gradient(to top, var(--background) 0%, color-mix(in oklab, var(--background) 92%, transparent) 45%, transparent 100%)",
          }}
        />
      </div>

      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-1 pt-3 pb-4 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Legend</span>

        <span className="flex items-center gap-1.5">
          <Chip tone="adjusted">+12%</Chip>
          Price adjusted
        </span>

        <span className="flex items-center gap-1.5">
          <Chip tone="restricted">Min 2</Chip>
          Bookable, with a restriction
        </span>

        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block h-3 w-6 rounded border",
              CELL_STATE_STYLE.closed.className,
            )}
          />
          Stop-sell
        </span>

        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-6 rounded border border-(--ari-border-strong)"
            style={HATCH_STYLE}
          />
          Room type closed
        </span>

        <span className="flex items-center gap-1.5">
          <Chip tone="sold_out">Sold out</Chip>
          No inventory left
        </span>

        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-(--ari-adjusted-fg)" />
          Adjusted, where a restriction has taken the chip slot
        </span>

        <span className="flex items-center gap-1.5">
          <Chip tone="unsaved">Unsaved</Chip>
          Staged, not published yet
        </span>
      </div>
    </div>
  );
}
