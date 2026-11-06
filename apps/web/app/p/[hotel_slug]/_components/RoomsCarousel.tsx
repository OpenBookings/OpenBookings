"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  motion, AnimatePresence, MotionConfig, useAnimate, useReducedMotion,
  type Transition, type Variants,
} from "framer-motion";
import {
  ChevronLeft, ChevronRight, Calendar, Users, Minus, Plus, Heart, Check, Ban, Coffee, ArrowRight,
} from "lucide-react";
import type { DbRoom, DbRatePlan } from "./constants";
import { TIER_SUMMARIES } from "@openbookings/pricing";
import { useRoomLikes } from "./use-room-likes";
import { todayInZone } from "@/lib/booking/stay-input";
import { guestsLabel, partyFromParams, stayDatesLabel, stayFromParams, withStay, type Stay, type StayDraft } from "../_lib/stay";
import { mergeQuote, pruneQuantities, type PricedRate, type QuoteState, type RoomView } from "../_lib/merge-quote";
import { useStayQuote } from "../_lib/useStayQuote";
import { StayPickers, type StayPanel } from "./StayPickers";

type ViewMode = "images" | "rates";

// ── Motion ────────────────────────────────────────────────────────────────────
// One duration and one curve for everything that moves, so pieces that move
// together also finish together.
//
// Images → Rates: the photo blurs and the room panel glides left, together.
// Once the panel is past, the rate rows slide in one after another.
// Rates → Images: the same steps in reverse. Rows leave first, then the panel
// glides back and the blur clears.

const EASE = [0.32, 0.72, 0, 1] as const;
const DURATION = 0.45;
const MOVE: Transition = { type: "tween", duration: DURATION, ease: EASE };
const QUICK_DURATION = 0.16;
const QUICK: Transition = { type: "tween", duration: QUICK_DURATION, ease: "easeOut" };
/** How far the summary bar drops when it leaves. */
const BAR_DROP_PX = 16;
/** How long the rate rows take to leave before the panel starts moving back. */
const ROWS_OUT = 0.14;

/** The panel, the blur, and anything else that moves with them. */
function stageTransition(viewMode: ViewMode): Transition {
  return { ...MOVE, delay: viewMode === "images" ? ROWS_OUT : 0 };
}

const slideVariants: Variants = {
  enter:  (d: number) => ({ x: d > 0 ? "100%" : "-100%" }),
  center: { x: 0 },
  exit:   (d: number) => ({ x: d > 0 ? "-100%" : "100%" }),
};

const rowsVariants: Variants = {
  hidden: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
  shown:  { transition: { delayChildren: DURATION * 0.55, staggerChildren: 0.07 } },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, x: 24, transition: QUICK },
  shown:  { opacity: 1, x: 0, transition: { ...MOVE, duration: 0.38 } },
};

// ── Formatting ────────────────────────────────────────────────────────────────

const EURO_WHOLE = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EURO_CENTS = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

/** "€1,001.70". Whole euros stay whole; anything else shows its cents. */
function euro(amount: number): string {
  return (Number.isInteger(amount) ? EURO_WHOLE : EURO_CENTS).format(amount);
}

/**
 * The all-in price for one night (tourist tax included, see withAllInPrices),
 * falling back to the host's rate where it was not worked out.
 */
function nightlyPrice(plan: DbRatePlan): number {
  return plan.price_per_night ?? plan.bar;
}

function tierOf(rate: DbRatePlan) {
  return rate.cancellation_tier ?? (rate.is_refundable ? "standard" : "non_refundable");
}

/** "Free cancellation until 24 hours before check-in" — the summary's lead sentence. */
function cancellationLine(rate: DbRatePlan): string {
  return TIER_SUMMARIES[tierOf(rate)].split(". ")[0].replace(/\.$/, "");
}

/** The stay as the room panel's date and guest fields show it. */
type StayFields = {
  hasStay: boolean;
  datesLabel: string;
  guestsLabel: string;
  onOpenDates: () => void;
  onOpenGuests: () => void;
};

// Panel geometry, shared by the panel itself and the rates area beside it.
const PANEL_WIDTH = "min(28%, 296px)";
const PANEL_MAX_PX = 296;
const PANEL_INSET_PX = 20; // top-5 / right-5

// ── Room navigation ───────────────────────────────────────────────────────────

function RoomNav({ activeIndex, count, onNavigate }: { activeIndex: number; count: number; onNavigate: (i: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-6 py-6 shrink-0">
      <button
        type="button"
        aria-label="Previous room"
        onClick={() => onNavigate(activeIndex - 1)}
        disabled={activeIndex === 0}
        className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/60 transition-colors hover:bg-white/16 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="size-5" strokeWidth={1.8} />
      </button>

      <div className="flex items-center gap-2.5">
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Go to room ${i + 1}`}
            aria-current={i === activeIndex ? "true" : undefined}
            onClick={() => onNavigate(i)}
            className="relative flex size-6 items-center justify-center"
          >
            <motion.span
              animate={{ width: i === activeIndex ? 20 : 6, opacity: i === activeIndex ? 1 : 0.35 }}
              initial={false}
              transition={MOVE}
              className="block h-1.5 rounded-full bg-white"
            />
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="Next room"
        onClick={() => onNavigate(activeIndex + 1)}
        disabled={activeIndex === count - 1}
        className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/60 transition-colors hover:bg-white/16 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
      >
        <ChevronRight className="size-5" strokeWidth={1.8} />
      </button>
    </div>
  );
}

// ── Room panel ────────────────────────────────────────────────────────────────
// Sits on the right in "images" mode and glides to the left in "rates" mode.
// It is always anchored right and moved with a transform, so the glide is a
// plain tween on x rather than a layout animation.

type RoomPanelProps = {
  room: DbRoom;
  view: RoomView;
  stayFields: StayFields;
  viewMode: ViewMode;
  /** How far left the panel travels in rates mode, in px. */
  ratesOffset: number;
  liked: boolean;
  onToggleLike: () => void;
  onViewRates: () => void;
};

function RoomPanel({ room, view, stayFields, viewMode, ratesOffset, liked, onToggleLike, onViewRates }: RoomPanelProps) {
  // With dates, the cheapest quoted night; without, today's prices as before.
  const quoted = Object.values(view.rates).filter((r): r is PricedRate => r !== null);
  const fromPrice = stayFields.hasStay
    ? (quoted.length > 0 ? Math.min(...quoted.map((r) => r.perNight)) : null)
    : room.rate_plans.length > 0
      ? Math.min(...room.rate_plans.map(nightlyPrice))
      : null;

  return (
    <motion.div
      initial={false}
      animate={{ x: viewMode === "rates" ? -ratesOffset : 0 }}
      transition={stageTransition(viewMode)}
      className="absolute top-5 right-5 bottom-5 z-10 bg-black/50 backdrop-blur-2xl rounded-2xl border border-white/15 shadow-2xl flex flex-col overflow-hidden"
      style={{ width: PANEL_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-5 [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-thumb]:bg-white/10">
        <div className="flex flex-col items-center text-center">
          <h3 className="font-serif text-2xl sm:text-[1.7rem] text-white leading-snug">
            {room.name}
          </h3>
          <p className="text-sm text-white/60 mt-1">
            {[room.size_sqm != null ? `${room.size_sqm} m²` : null, room.bed_type].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>

        {room.description && (
          <p className="text-sm text-white/90 leading-relaxed">{room.description}</p>
        )}

        {room.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-auto">
            {room.tags.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 text-xs rounded-full border border-white/15 bg-white/8 text-white/90 leading-none"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 pt-4 pb-5 border-t border-white/10 shrink-0">
        <AnimatePresence mode="wait" initial={false}>
          {viewMode === "images" ? (
            <motion.div
              key="images"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={QUICK}
              className="flex flex-col gap-3"
            >
              <div>
                <p className="text-xs text-white/60">From</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-serif text-3xl text-white">{fromPrice != null ? euro(fromPrice) : "—"}</span>
                  <span className="text-sm text-white/60">/ night</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label={liked ? "Remove from favourites" : "Add to favourites"}
                  aria-pressed={liked}
                  onClick={onToggleLike}
                  className={`size-11 flex items-center justify-center rounded-xl border transition-colors ${
                    liked
                      ? "bg-red-500/15 border-red-500/25 text-red-400"
                      : "bg-white/5 border-white/15 text-white/60 hover:text-white"
                  }`}
                >
                  <Heart className={`size-4 ${liked ? "fill-current" : ""}`} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={onViewRates}
                  className="flex-1 h-11 bg-white text-black font-semibold text-sm rounded-xl hover:bg-white/90 transition-colors"
                >
                  View Rates
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="rates"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={QUICK}
              className="flex flex-col gap-3"
            >
              <button
                type="button"
                onClick={stayFields.onOpenDates}
                className="w-full h-10 rounded-xl border border-white/15 bg-white/5 px-3.5 flex items-center justify-between text-sm text-white/90 hover:bg-white/10 transition-colors"
              >
                <span>{stayFields.datesLabel}</span>
                <Calendar className="size-3.5 shrink-0 text-white/60" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={stayFields.onOpenGuests}
                className="w-full h-10 rounded-xl border border-white/15 bg-white/5 px-3.5 flex items-center justify-between text-sm text-white/90 hover:bg-white/10 transition-colors"
              >
                <span>{stayFields.guestsLabel}</span>
                <Users className="size-3.5 shrink-0 text-white/60" strokeWidth={1.8} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Rate row ──────────────────────────────────────────────────────────────────

type RateRowProps = {
  rate: DbRatePlan;
  /** The stay's price, or null: today's price without a stay, "—" while a stay's price is missing. */
  priced: PricedRate | null;
  hasStay: boolean;
  leftCaption: string | null;
  /** False once the room's picks, all its rates together, reach the rooms left. */
  canAdd: boolean;
  maxOccupancy: number | null;
  qty: number;
  onQtyChange: (v: number) => void;
  ratesConfirmed: boolean;
};

function RateRow({ rate, priced, hasStay, leftCaption, canAdd, maxOccupancy, qty, onQtyChange, ratesConfirmed }: RateRowProps) {
  const tier = tierOf(rate);
  const saving = priced ? priced.saving : hasStay ? 0 : (rate.saving_vs_refundable ?? 0);
  const price = priced ? euro(priced.perNight) : hasStay ? "—" : euro(nightlyPrice(rate));

  return (
    <motion.div
      variants={rowVariants}
      // Selected rows get the spectrum edge (globals.css), light catching the glass.
      data-active={qty > 0}
      className="spectrum-border bg-black/50 backdrop-blur-2xl rounded-2xl border border-white/15 shadow-xl p-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4"
    >
      {/* What you get */}
      <div className="flex flex-col gap-2.5 min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-white text-base leading-snug">{rate.name}</p>
          {saving > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-400/15 border border-emerald-400/25 text-emerald-300 leading-tight">
              Save {euro(saving)} / night
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {maxOccupancy != null && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-white/15 bg-white/8 text-white/90 leading-none">
              <Users className="size-3 text-white/60" strokeWidth={2} />
              Sleeps {maxOccupancy}
            </span>
          )}
          {rate.meal_plan && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-white/15 bg-white/8 text-white/90 leading-none">
              <Coffee className="size-3 text-white/60" strokeWidth={2} />
              {rate.meal_plan}
            </span>
          )}
        </div>

        <p title={TIER_SUMMARIES[tier]} className="flex items-start gap-1.5 text-[13px] leading-snug text-white/90">
          {rate.is_refundable ? (
            <Check className="size-3.5 mt-0.5 shrink-0 text-emerald-400" strokeWidth={2.4} />
          ) : (
            <Ban className="size-3.5 mt-0.5 shrink-0 text-amber-300" strokeWidth={2} />
          )}
          {cancellationLine(rate)}
        </p>
      </div>

      {/* What it costs */}
      <div className="flex items-center gap-5 shrink-0 ml-auto">
        <div className="text-right">
          <p className="font-serif text-3xl text-white leading-none">{price}</p>
          {/* Only claimed once the host has confirmed, on record, that their
              rates include tax. Until then the property cannot be booked. */}
          <p className="text-xs text-white/60 mt-1.5">
            {ratesConfirmed ? "per night · incl. tax & fees" : "per night · not bookable yet"}
          </p>
          {leftCaption && <p className="text-xs text-white/60 mt-1.5">{leftCaption}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={`One fewer ${rate.name}`}
            onClick={() => onQtyChange(qty - 1)}
            disabled={qty === 0}
            className="size-8 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-white/90 hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus className="size-3.5" strokeWidth={2} />
          </button>
          <span aria-live="polite" className="w-6 text-center text-sm font-medium text-white tabular-nums">{qty}</span>
          <button
            type="button"
            aria-label={`One more ${rate.name}`}
            onClick={() => onQtyChange(qty + 1)}
            disabled={!canAdd}
            className="size-8 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-white/90 hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Room slide ────────────────────────────────────────────────────────────────
// Photo, room panel and rate rows for one room. They live in one sliding unit,
// so a room change moves all of them together.

type RoomSlideProps = {
  room: DbRoom;
  view: RoomView;
  stayFields: StayFields;
  /** The stay's prices could not be loaded. */
  quoteFailed: boolean;
  imageIndex: number;
  onImageIndex: (i: number) => void;
  viewMode: ViewMode;
  ratesOffset: number;
  liked: boolean;
  onToggleLike: () => void;
  onViewRates: () => void;
  quantities: Record<string, number>;
  onQtyChange: (id: string, v: number) => void;
  ratesConfirmed: boolean;
};

function RoomSlide({
  room, view, stayFields, quoteFailed, imageIndex, onImageIndex, viewMode, ratesOffset, liked, onToggleLike, onViewRates,
  quantities, onQtyChange, ratesConfirmed,
}: RoomSlideProps) {
  const imageCount = room.images.length;
  const shownRates = room.rate_plans.filter((rate) => rate.id in view.rates);
  const picked = room.rate_plans.reduce((n, rate) => n + (quantities[rate.id] ?? 0), 0);
  const canAdd = view.unitsLeft === null || picked < view.unitsLeft;

  return (
    <>
      {/* Photos cross-blend: the new one fades in over the old, which stays put
          until it is covered, so there is no dip to black in between. */}
      <AnimatePresence initial={false}>
        <motion.div
          key={imageIndex}
          initial={{ opacity: 0, zIndex: 1 }}
          animate={{ opacity: 1, zIndex: 1 }}
          exit={{ opacity: 0, zIndex: 0, transition: { delay: 0.6, duration: 0 } }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          {room.images[imageIndex] && (
            <Image
              src={room.images[imageIndex]}
              alt=""
              fill
              sizes="(min-width: 1152px) 1056px, 100vw"
              className="object-cover object-center"
              draggable={false}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <div className="absolute inset-0 z-[2] bg-linear-to-r from-black/45 via-transparent to-transparent" />
      <div className="absolute inset-0 z-[2] bg-linear-to-t from-black/55 via-transparent to-black/15" />

      {/* Starts in the current state, so a new room never flashes a sharp
          photo while the rates are open. */}
      <motion.div
        className="absolute inset-0 z-[3] backdrop-blur-md bg-black/45 pointer-events-none"
        initial={false}
        animate={{ opacity: viewMode === "rates" ? 1 : 0 }}
        transition={stageTransition(viewMode)}
      />

      <AnimatePresence initial={false}>
        {imageCount > 1 && viewMode === "images" && (
          <motion.div
            key="image-controls"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { ...QUICK, delay: ROWS_OUT + DURATION * 0.6 } }}
            exit={{ opacity: 0, transition: QUICK }}
            className="absolute bottom-6 left-7 z-10 flex items-center gap-3"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => onImageIndex((imageIndex - 1 + imageCount) % imageCount)}
              className="flex size-7 items-center justify-center rounded-full bg-black/35 backdrop-blur-md border border-white/15 text-white/60 hover:text-white hover:bg-black/55 transition-colors"
            >
              <ChevronLeft className="size-3.5" strokeWidth={2} />
            </button>

            <div className="flex items-center gap-1.5">
              {room.images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Image ${i + 1}`}
                  aria-current={i === imageIndex ? "true" : undefined}
                  onClick={() => onImageIndex(i)}
                  className={`rounded-full transition-all duration-300 ${
                    i === imageIndex
                      ? "w-6 h-1.5 bg-white"
                      : "w-1.5 h-1.5 bg-white/40 hover:bg-white/70"
                  }`}
                />
              ))}
            </div>

            <button
              type="button"
              aria-label="Next image"
              onClick={() => onImageIndex((imageIndex + 1) % imageCount)}
              className="flex size-7 items-center justify-center rounded-full bg-black/35 backdrop-blur-md border border-white/15 text-white/60 hover:text-white hover:bg-black/55 transition-colors"
            >
              <ChevronRight className="size-3.5" strokeWidth={2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <RoomPanel
        room={room}
        view={view}
        stayFields={stayFields}
        viewMode={viewMode}
        ratesOffset={ratesOffset}
        liked={liked}
        onToggleLike={onToggleLike}
        onViewRates={onViewRates}
      />

      {/* Rate rows, to the right of where the panel lands in rates mode. Room
          for the summary bar is kept free at the bottom. */}
      <div
        className="absolute z-10 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-thumb]:bg-white/10"
        style={{
          top: PANEL_INSET_PX,
          bottom: PANEL_INSET_PX + 72,
          right: PANEL_INSET_PX,
          left: `calc(${PANEL_WIDTH} + ${PANEL_INSET_PX * 2}px)`,
          pointerEvents: viewMode === "rates" ? "auto" : "none",
        }}
        inert={viewMode !== "rates"}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <motion.div
          variants={rowsVariants}
          initial={false}
          animate={viewMode === "rates" ? "shown" : "hidden"}
          className="flex flex-col gap-3.5 min-h-full justify-center"
        >
          {room.rate_plans.length === 0 && (
            <motion.p
              variants={rowVariants}
              className="self-center px-5 py-3 rounded-2xl bg-black/50 backdrop-blur-2xl border border-white/15 text-sm text-white/90"
            >
              No rates available for this room yet.
            </motion.p>
          )}
          {shownRates.map((rate) => (
            <RateRow
              key={rate.id}
              rate={rate}
              priced={view.rates[rate.id] ?? null}
              hasStay={stayFields.hasStay}
              leftCaption={view.leftCaption}
              canAdd={canAdd}
              maxOccupancy={room.max_occupancy}
              qty={quantities[rate.id] ?? 0}
              onQtyChange={(v) => onQtyChange(rate.id, v)}
              ratesConfirmed={ratesConfirmed}
            />
          ))}
          {quoteFailed && (
            <motion.p
              variants={rowVariants}
              className="self-center px-5 py-3 rounded-2xl bg-black/50 backdrop-blur-2xl border border-white/15 text-sm text-white/90"
            >
              We couldn&apos;t load prices for these dates.
            </motion.p>
          )}
        </motion.div>
      </div>
    </>
  );
}

// ── Selection summary ─────────────────────────────────────────────────────────
// Sits on the stage, not the slide: it counts rooms picked across every room
// type, so it stays put while the guest flips between rooms.

type Selection = {
  rateId: string;
  roomIndex: number;
  roomName: string;
  rateName: string;
  qty: number;
};

type RoomPicks = { roomIndex: number; picks: Selection[] };

function SelectionSummary({ rooms, views, stay, quantities, visible, ratesConfirmed, activeIndex }: {
  /** The rooms shown, and their views in the same order. */
  rooms: DbRoom[];
  views: RoomView[];
  stay: Stay | null;
  quantities: Record<string, number>;
  visible: boolean;
  ratesConfirmed: boolean;
  activeIndex: number;
}) {
  // Picks grouped by room, in the order the rooms appear. The order never
  // changes with the room on screen, so tags don't swap places.
  const groups: RoomPicks[] = [];
  let nightlyTotal = 0;
  let quotedTotal = 0;
  let allQuoted = true;
  rooms.forEach((room, roomIndex) => {
    const picks: Selection[] = [];
    for (const rate of room.rate_plans) {
      const qty = quantities[rate.id] ?? 0;
      if (qty === 0) continue;
      picks.push({ rateId: rate.id, roomIndex, roomName: room.name, rateName: rate.name, qty });
      nightlyTotal += qty * nightlyPrice(rate);
      const priced = views[roomIndex]?.rates[rate.id];
      if (priced) quotedTotal += qty * priced.total;
      else allQuoted = false;
    }
    if (picks.length > 0) groups.push({ roomIndex, picks });
  });
  // With dates, the stay's quoted total; without, today's price for one night.
  const shownTotal = stay
    ? (allQuoted ? Math.round(quotedTotal * 100) / 100 : null)
    : Math.round(nightlyTotal * 100) / 100;
  const groupsKey = groups.map((g) => g.roomIndex).join(",");

  // If the tags overflow, the room on screen is scrolled into view.
  const listRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const scrollToRoom = useCallback((room: number, behavior: ScrollBehavior) => {
    const list = listRef.current;
    const group = list?.querySelector<HTMLElement>(`[data-room="${room}"]`);
    if (!list || !group) return;
    const left = group.offsetLeft - (list.clientWidth - group.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior });
  }, []);

  // A pick added or removed: glide to the room on screen.
  useEffect(() => {
    scrollToRoom(activeIndex, reduceMotion ? "auto" : "smooth");
    // Only when the picks change; a room change is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsKey]);

  // A room change replays the bar's own exit and entry. It drops away as the
  // old room starts to leave, stays out of sight while the rooms slide, and
  // rises back in once the new room has landed, as if it loads onto that
  // room. Bar and Book move as one. While hidden, the tags jump to the new room.
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const lastRoom = useRef(activeIndex);
  useEffect(() => {
    if (lastRoom.current === activeIndex) return;
    lastRoom.current = activeIndex;
    if (!scope.current || reduceMotion) {
      scrollToRoom(activeIndex, "auto");
      return;
    }
    // Out with the exit timing, wait for the slide to land, in with the entry
    // timing. Starting from the current values (null) keeps quick clicks
    // through several rooms from flashing the bar back in between.
    const total = DURATION + DURATION;
    animate(
      scope.current,
      { y: [null, BAR_DROP_PX, BAR_DROP_PX, 0], opacity: [null, 0, 0, 1] },
      {
        duration: total,
        times: [0, QUICK_DURATION / total, DURATION / total, 1],
        ease: ["easeOut", "linear", EASE],
      },
    );
    const id = setTimeout(() => scrollToRoom(activeIndex, "auto"), QUICK_DURATION * 1000);
    return () => clearTimeout(id);
  }, [activeIndex, animate, scope, reduceMotion, scrollToRoom]);

  return (
    <AnimatePresence>
      {visible && groups.length > 0 && (
        <motion.div
          key="summary"
          initial={{ opacity: 0, y: BAR_DROP_PX }}
          animate={{ opacity: 1, y: 0, transition: MOVE }}
          exit={{ opacity: 0, y: BAR_DROP_PX, transition: QUICK }}
          className="absolute z-20 h-14"
          style={{
            bottom: PANEL_INSET_PX,
            right: PANEL_INSET_PX,
            left: `calc(${PANEL_WIDTH} + ${PANEL_INSET_PX * 2}px)`,
          }}
        >
          <div ref={scope} className="flex items-stretch gap-2 h-full">
            <div className="flex-1 min-w-0 bg-black/70 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl px-5 flex items-center gap-4">
              {/* What has been picked: one tag per room and rate, grouped by room */}
              <motion.div
                ref={listRef}
                layoutScroll
                className="relative flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]"
              >
                {/* Each pick is set like the total on the right: bold line on top,
                    small grey line under it. A hairline separates picks. */}
                <ul
                  aria-label="Your selection"
                  className="flex items-center gap-4 w-max pr-6 [&>li:first-child>div:first-child]:border-l-0 [&>li:first-child>div:first-child]:pl-0"
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    {groups.map((g) => (
                      <motion.li
                        key={g.roomIndex}
                        data-room={g.roomIndex}
                        layout="position"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={MOVE}
                        className="flex items-center gap-4"
                      >
                        {g.picks.map((p) => (
                          <div
                            key={p.rateId}
                            className="whitespace-nowrap border-l border-white/15 pl-4"
                          >
                            <p className="text-sm font-semibold text-white leading-none">
                              <span className="tabular-nums">{p.qty}×</span> {p.roomName}
                            </p>
                            <p className="text-[11px] text-white/60 mt-1 leading-none">{p.rateName}</p>
                          </div>
                        ))}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </motion.div>

              {/* What the stay costs */}
              <div className="shrink-0 text-right" aria-live="polite">
                <p className="text-base font-semibold text-white tabular-nums leading-none">
                  {shownTotal != null ? euro(shownTotal) : "—"}
                </p>
                <p className="text-[11px] text-white/60 mt-1 leading-none">
                  {!ratesConfirmed
                    ? "Not bookable yet"
                    : stay
                      ? `total · ${stay.nights} ${stay.nights === 1 ? "night" : "nights"} · incl. tax`
                      : "Pick your dates"}
                </p>
              </div>
            </div>

            {/* Inset 1px top and bottom: solid white reads taller than the dark
                glass beside it, so this makes the two look the same height.
                Not wired yet: checkout still reads one fixed, seeded booking
                rather than a selection made here. */}
            <button
              type="button"
              disabled={!ratesConfirmed || shownTotal == null}
              className="group shrink-0 my-px pl-6 pr-5 rounded-[15px] bg-white text-black text-sm font-semibold flex items-center gap-2 transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Book now
              <ArrowRight
                className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-disabled:translate-x-0"
                strokeWidth={2.2}
              />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Stage ─────────────────────────────────────────────────────────────────────

type StageProps = {
  /** The rooms shown, and their views in the same order. */
  rooms: DbRoom[];
  views: RoomView[];
  stay: Stay | null;
  stayFields: StayFields;
  quoteFailed: boolean;
  activeIndex: number;
  dir: number;
  onNavigate: (i: number) => void;
  viewMode: ViewMode;
  liked: Set<string>;
  onToggleLike: () => void;
  onViewRates: () => void;
  quantities: Record<string, number>;
  onQtyChange: (id: string, v: number) => void;
  ratesConfirmed: boolean;
};

function RoomsStage({
  rooms, views, stay, stayFields, quoteFailed, activeIndex, dir, onNavigate, viewMode, liked, onToggleLike, onViewRates,
  quantities, onQtyChange, ratesConfirmed,
}: StageProps) {
  const count = rooms.length;
  const room = rooms[activeIndex];
  const imageCount = room.images.length;

  const [imageIndex, setImageIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.3 });
    const ro = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
    io.observe(el);
    ro.observe(el);
    return () => { io.disconnect(); ro.disconnect(); };
  }, []);

  // A new room starts on its first photo.
  const [shownRoom, setShownRoom] = useState(activeIndex);
  if (shownRoom !== activeIndex) {
    setShownRoom(activeIndex);
    setImageIndex(0);
  }

  // Panel travels from right-5 to left-5: the stage minus both insets and itself.
  const panelWidth = Math.min(stageWidth * 0.28, PANEL_MAX_PX);
  const ratesOffset = Math.max(0, stageWidth - PANEL_INSET_PX * 2 - panelWidth);

  // Autoplay cycles this room's photos only. Changing room is always the
  // guest's own action.
  useEffect(() => {
    if (hovered || !visible || viewMode === "rates" || imageCount < 2) return;
    const id = setTimeout(() => setImageIndex((i) => (i + 1) % imageCount), 4000);
    return () => clearTimeout(id);
  }, [hovered, visible, viewMode, imageIndex, imageCount]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.key === "ArrowLeft" && activeIndex > 0) onNavigate(activeIndex - 1);
      if (e.key === "ArrowRight" && activeIndex < count - 1) onNavigate(activeIndex + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, activeIndex, count, onNavigate]);

  return (
    <div className="flex flex-col select-none">
      <div className="px-4 sm:px-8 md:px-12 py-6 max-w-6xl mx-auto w-full">
        <div
          ref={stageRef}
          className="relative rounded-3xl overflow-hidden bg-white/4"
          style={{ height: "min(72vh, 680px)" }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* The old room slides out while the new one slides in. */}
          <AnimatePresence custom={dir} initial={false}>
            <motion.div
              key={activeIndex}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={MOVE}
              className={`absolute inset-0 ${viewMode === "images" ? "cursor-grab active:cursor-grabbing" : ""}`}
              drag={viewMode === "images" ? "x" : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.12}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                if (info.offset.x < -55 && activeIndex < count - 1) onNavigate(activeIndex + 1);
                else if (info.offset.x > 55 && activeIndex > 0) onNavigate(activeIndex - 1);
              }}
            >
              <RoomSlide
                room={room}
                view={views[activeIndex]}
                stayFields={stayFields}
                quoteFailed={quoteFailed}
                imageIndex={imageIndex}
                onImageIndex={setImageIndex}
                viewMode={viewMode}
                ratesOffset={ratesOffset}
                liked={liked.has(room.id)}
                onToggleLike={onToggleLike}
                onViewRates={onViewRates}
                quantities={quantities}
                onQtyChange={onQtyChange}
                ratesConfirmed={ratesConfirmed}
              />
            </motion.div>
          </AnimatePresence>

          <SelectionSummary
            rooms={rooms}
            views={views}
            stay={stay}
            quantities={quantities}
            visible={viewMode === "rates"}
            ratesConfirmed={ratesConfirmed}
            activeIndex={activeIndex}
          />
        </div>
      </div>

      <RoomNav activeIndex={activeIndex} count={count} onNavigate={onNavigate} />
    </div>
  );
}

// ── Section export ────────────────────────────────────────────────────────────

type RoomsSectionProps = {
  rooms: DbRoom[];
  ratesConfirmed: boolean;
  slug: string;
  propertyId: string;
  /** The property's zone: "today" for its dates. */
  timeZone: string;
};

/**
 * The page HTML is cached and the same for everyone, so the stay (dates and
 * guests from the URL) is read in the browser. Reading the URL makes
 * everything under the nearest Suspense boundary render in the browser; the
 * fallback is the same section without a stay, so the cached HTML still
 * carries the rooms at today's prices.
 */
export function RoomsSection(props: RoomsSectionProps) {
  if (props.rooms.length === 0) return null;
  return (
    <Suspense fallback={<RoomsSectionView {...props} search={null} />}>
      <RoomsSectionWithStay {...props} />
    </Suspense>
  );
}

function RoomsSectionWithStay(props: RoomsSectionProps) {
  const search = useSearchParams();
  return <RoomsSectionView {...props} search={search} />;
}

function RoomsSectionView({ rooms, ratesConfirmed, slug, timeZone, search }: RoomsSectionProps & {
  search: URLSearchParams | null;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("images");
  const [activeIndex, setActiveIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const likes = useRoomLikes(rooms.map((r) => r.id));
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const searchKey = search?.toString() ?? "";
  const stay = useMemo(
    () => (searchKey ? stayFromParams(new URLSearchParams(searchKey), todayInZone(timeZone)) : null),
    [searchKey, timeZone],
  );
  // The guest picker's starting point: the stay's party, or the URL's without dates.
  const party = useMemo(() => {
    if (stay) return { adults: stay.adults, children: stay.children, rooms: stay.rooms };
    return partyFromParams(new URLSearchParams(searchKey));
  }, [stay, searchKey]);
  const quote: QuoteState = useStayQuote(slug, stay);
  const allViews = useMemo(() => mergeQuote(rooms, quote), [rooms, quote]);

  // Only rooms that can be booked for the stay are shown; the carousel counts those.
  const shown = rooms.map((room, i) => ({ room, view: allViews[i] })).filter((r) => r.view.visible);
  const shownRooms = shown.map((r) => r.room);
  const shownViews = shown.map((r) => r.view);
  const current = Math.min(activeIndex, Math.max(0, shownRooms.length - 1));

  // Picks of rates the stay hides, or beyond the rooms left, are dropped.
  const pruned = pruneQuantities(rooms, allViews, quantities);
  if (pruned !== quantities) setQuantities(pruned);

  // A picked stay goes into the URL, which re-runs the quote.
  const router = useRouter();
  const pathname = usePathname();
  const [panel, setPanel] = useState<StayPanel>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const applyStay = useCallback((next: StayDraft) => {
    router.replace(`${pathname}?${withStay(new URLSearchParams(searchKey), next).toString()}`, { scroll: false });
  }, [router, pathname, searchKey]);

  const stayFields: StayFields = {
    hasStay: stay !== null,
    datesLabel: stay ? stayDatesLabel(stay) : "Pick dates",
    guestsLabel: guestsLabel(party),
    onOpenDates: () => setPanel("dates"),
    onOpenGuests: () => setPanel("guests"),
  };

  const navigate = useCallback((i: number) => {
    if (i === current || i < 0 || i >= shownRooms.length) return;
    setDir(i > current ? 1 : -1);
    setActiveIndex(i);
  }, [current, shownRooms.length]);

  const { toggle } = likes;
  const activeRoomId = shownRooms[current]?.id;
  const toggleLike = useCallback(() => {
    if (activeRoomId) toggle(activeRoomId);
  }, [activeRoomId, toggle]);

  const setQty = useCallback((id: string, val: number) => {
    if (val < 0) return;
    setQuantities((q) => ({ ...q, [id]: val }));
  }, []);

  return (
    // Guests who ask for reduced motion get the fades but none of the sliding.
    <MotionConfig reducedMotion="user">
      <section id="rooms" className="bg-[#111111] border-t border-white/6 flex flex-col pt-10 pb-4">
        <div className="text-center px-4 mb-6 shrink-0">
          <p className="text-xs uppercase tracking-[0.2em] text-white/60 mb-3">Accommodations</p>
          <h2 className="font-serif text-4xl sm:text-5xl">Rooms &amp; Suites</h2>
        </div>

        <div className="flex justify-center mb-2 shrink-0">
          <div role="tablist" aria-label="Show rooms as" className="flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/10">
            {(["images", "rates"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={viewMode === v}
                onClick={() => setViewMode(v)}
                className={`relative px-5 py-1.5 rounded-full text-sm font-medium transition-colors duration-300 ${
                  viewMode === v ? "text-black" : "text-white/60 hover:text-white"
                }`}
              >
                {viewMode === v && (
                  <motion.span
                    layoutId="rooms-view-pill"
                    transition={MOVE}
                    className="absolute inset-0 rounded-full bg-white"
                  />
                )}
                <span className="relative">{v === "images" ? "Images" : "Rates"}</span>
              </button>
            ))}
          </div>
        </div>

        {shownRooms.length === 0 ? (
          // Only once the quote is in: until then every room shows.
          <div className="px-4 py-10 flex flex-col items-center gap-3">
            <p className="text-sm text-white/90">Nothing is available for these dates.</p>
            <button
              type="button"
              onClick={stayFields.onOpenDates}
              className="h-10 rounded-xl border border-white/15 bg-white/5 px-3.5 text-sm text-white/90 hover:bg-white/10 transition-colors"
            >
              Change dates
            </button>
          </div>
        ) : (
          <RoomsStage
            rooms={shownRooms}
            views={shownViews}
            stay={stay}
            stayFields={stayFields}
            quoteFailed={stay !== null && quote.status === "error"}
            activeIndex={current}
            dir={dir}
            onNavigate={navigate}
            viewMode={viewMode}
            liked={likes.liked}
            onToggleLike={toggleLike}
            onViewRates={() => setViewMode("rates")}
            quantities={quantities}
            onQtyChange={setQty}
            ratesConfirmed={ratesConfirmed}
          />
        )}
        <StayPickers stay={stay} party={party} openPanel={panel} onClose={closePanel} onChange={applyStay} />
        {likes.signIn}
      </section>
    </MotionConfig>
  );
}
