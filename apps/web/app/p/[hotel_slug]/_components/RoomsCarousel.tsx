"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, Calendar, Users, Minus, Plus, Heart,
} from "lucide-react";
import type { DbRoom, DbRatePlan } from "./constants";

const slideVariants = {
  enter:  (d: number) => ({ x: d > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:   (d: number) => ({ x: d > 0 ? "-60%" : "60%", opacity: 0, scale: 0.96 }),
};

type ViewMode = "images" | "rates";

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const BASE_DATE = new Date();
const CHECK_IN  = formatDate(BASE_DATE);
const CHECK_OUT = formatDate(new Date(BASE_DATE.getFullYear(), BASE_DATE.getMonth(), BASE_DATE.getDate() + 3));

// ── Shared room navigation ────────────────────────────────────────────────────

function RoomNav({ activeIndex, count, onNavigate }: { activeIndex: number; count: number; onNavigate: (i: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-6 py-6 shrink-0">
      <button
        type="button"
        aria-label="Previous room"
        onClick={() => onNavigate((activeIndex - 1 + count) % count)}
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
            onClick={() => onNavigate(i)}
            className="relative flex size-6 items-center justify-center"
          >
            <motion.span
              animate={{ width: i === activeIndex ? 20 : 6, opacity: i === activeIndex ? 1 : 0.35 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="block h-1.5 rounded-full bg-white"
            />
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="Next room"
        onClick={() => onNavigate((activeIndex + 1) % count)}
        disabled={activeIndex === count - 1}
        className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/60 transition-colors hover:bg-white/16 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
      >
        <ChevronRight className="size-5" strokeWidth={1.8} />
      </button>
    </div>
  );
}

// ── Room sidebar ──────────────────────────────────────────────────────────────
// Renders as a floating overlay panel in "images" mode and as a fixed left
// sidebar in "rates" mode. The wrapper adapts; the content is identical.

type RoomSidebarProps = {
  room: DbRoom;
  activeIndex: number;
  viewMode: ViewMode;
  liked: Set<number>;
  onToggleLike: () => void;
  onViewRates: () => void;
  totalRooms: number;
};

function RoomSidebar({ room, activeIndex, viewMode, liked, onToggleLike, onViewRates, totalRooms }: RoomSidebarProps) {
  const scrollable = (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-5 [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-thumb]:bg-white/10">
      <div className="flex flex-col items-center text-center">
        <h3 className="font-serif text-2xl sm:text-[1.7rem] text-white leading-snug">
          {room.name}
        </h3>
        <p className="text-sm text-white/35 mt-0.5 italic">
          {room.size_sqm != null ? `${room.size_sqm} m²` : "—"} · {room.bed_type ?? "—"}
        </p>
      </div>
 

      {room.description && (
        <p className="text-sm text-white/55 leading-relaxed">{room.description}</p>
      )}

      {room.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-auto">
          {room.tags.map((tag) => (
            <span
              key={tag}
              className="px-2.5 py-1 text-[11px] rounded-full border border-white/10 bg-white/5 text-white/50 leading-none"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
 
    </div>
  );

  const footer = (
    <div className="px-5 pt-4 pb-5 border-t border-white/8 flex flex-col gap-3 shrink-0">

      {viewMode === "images" ? (
        <>
          <div>
            <p className="text-xs text-white/35">From</p>
            <div className="flex items-baseline gap-1.5">
              <span className="font-serif text-3xl text-white">€{room.rate_plans[0]?.bar ?? "—"}</span>
              <span className="text-sm text-white/35">/ night</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Like this room"
              onClick={onToggleLike}
              className={`size-11 flex items-center justify-center rounded-xl border transition-all ${
                liked.has(activeIndex)
                  ? "bg-red-500/15 border-red-500/25 text-red-400"
                  : "bg-white/5 border-white/10 text-white/45 hover:text-white/75"
              }`}
            >
              <Heart
                className={`size-4 transition-all ${liked.has(activeIndex) ? "fill-current" : ""}`}
                strokeWidth={1.8}
              />
            </button>
            <button
              type="button"
              onClick={onViewRates}
              className="flex-1 h-11 bg-white text-black font-semibold text-sm rounded-xl hover:bg-white/90 transition-colors"
            >
              View Rates
            </button>
          </div>
        </>
  
      ) : (
        <>
          <button
            type="button"
            className="w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3.5 flex items-center justify-between text-sm text-white/55 hover:text-white/75 hover:bg-white/8 transition-colors"
          >
            <span>{CHECK_IN} – {CHECK_OUT}</span>
            <Calendar className="size-3.5 shrink-0 text-white/35" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3.5 flex items-center justify-between text-sm text-white/55 hover:text-white/75 hover:bg-white/8 transition-colors"
          >
            <span>2 Adults</span>
            <Users className="size-3.5 shrink-0 text-white/35" strokeWidth={1.8} />
          </button>
        </>
      )}
    </div>
  );

  const panelPosition = viewMode === "rates" ? "left-5" : "right-5";

  return (
    <motion.div
      layout
      className={`absolute top-5 ${panelPosition} bottom-5 w-[min(28%,296px)] bg-black/28 backdrop-blur-2xl rounded-2xl border border-white/12 flex flex-col overflow-hidden`}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {scrollable}
      {footer}
    </motion.div>
  );
}

// ── Image carousel ────────────────────────────────────────────────────────────

type CarouselProps = {
  rooms: DbRoom[];
  activeIndex: number;
  onNavigate: (i: number) => void;
  liked: Set<number>;
  onToggleLike: () => void;
  onViewRates: () => void;
  viewMode: ViewMode;
};

function RoomsCarousel({ rooms, activeIndex, onNavigate, liked, onToggleLike, onViewRates, viewMode }: CarouselProps) {
  const count = rooms.length;
  const [imageIndex, setImageIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const prevActiveIndex = useRef(activeIndex);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (prevActiveIndex.current !== activeIndex) {
      setImageIndex(0);
      prevActiveIndex.current = activeIndex;
    }
  }, [activeIndex]);

  const room = rooms[activeIndex];
  const imageCount = room.images.length;

  const prevImage = useCallback(() => setImageIndex((i) => (i - 1 + imageCount) % imageCount), [imageCount]);
  const nextImage = useCallback(() => setImageIndex((i) => (i + 1) % imageCount), [imageCount]);

  const navigate = useCallback((idx: number) => {
    setDir(idx > activeIndex ? 1 : -1);
    setImageIndex(0);
    onNavigate(idx);
  }, [activeIndex, onNavigate]);

  const prev = useCallback(() => navigate((activeIndex - 1 + count) % count), [navigate, activeIndex, count]);
  const next = useCallback(() => navigate((activeIndex + 1) % count), [navigate, activeIndex, count]);

  useEffect(() => {
    if (hovered || !visible || viewMode === "rates") return;
    const id = setTimeout(() => {
      if (imageIndex < imageCount - 1) setImageIndex((i) => i + 1);
      else next();
    }, 3000);
    return () => clearTimeout(id);
  }, [hovered, visible, viewMode, imageIndex, imageCount, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewMode === "rates") return;
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, viewMode]);

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
          <AnimatePresence custom={dir} mode="wait">
            <motion.div
              key={activeIndex}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "tween", duration: 0.48, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.12}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                if (info.offset.x < -55) next();
                else if (info.offset.x > 55) prev();
              }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={imageIndex}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.55 }}
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: room.images[imageIndex] ? `url('${room.images[imageIndex]}')` : undefined,
                  }}
                />
              </AnimatePresence>

              <div className="absolute inset-0 bg-linear-to-r from-black/45 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-linear-to-t from-black/55 via-transparent to-black/15" />

              <motion.div
                className="absolute inset-0 backdrop-blur-md bg-black/40 pointer-events-none"
                animate={{ opacity: viewMode === "rates" ? 1 : 0 }}
                initial={{ opacity: 0 }}
                transition={{ duration: 0.38, ease: "easeInOut" }}
              />

              {imageCount > 1 && viewMode !== "rates" && (
                <div className="absolute bottom-6 left-7 flex items-center gap-3 z-10" onPointerDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    aria-label="Previous image"
                    onClick={prevImage}
                    className="flex size-7 items-center justify-center rounded-full bg-black/35 backdrop-blur-md border border-white/15 text-white/65 hover:text-white hover:bg-black/55 transition-colors"
                  >
                    <ChevronLeft className="size-3.5" strokeWidth={2} />
                  </button>

                  <div className="flex items-center gap-1.5">
                    {room.images.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`Image ${i + 1}`}
                        onClick={() => setImageIndex(i)}
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
                    onClick={nextImage}
                    className="flex size-7 items-center justify-center rounded-full bg-black/35 backdrop-blur-md border border-white/15 text-white/65 hover:text-white hover:bg-black/55 transition-colors"
                  >
                    <ChevronRight className="size-3.5" strokeWidth={2} />
                  </button>
                </div>
              )}

              <RoomSidebar
                room={room}
                activeIndex={activeIndex}
                viewMode={viewMode}
                liked={liked}
                onToggleLike={onToggleLike}
                onViewRates={onViewRates}
                totalRooms={0}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <RoomNav activeIndex={activeIndex} count={count} onNavigate={onNavigate} />
    </div>
  );
}

// ── Rate card ─────────────────────────────────────────────────────────────────

function RateCard({ rate, maxOccupancy, qty, onQtyChange }: { rate: DbRatePlan; maxOccupancy: number | null; qty: number; onQtyChange: (v: number) => void }) {
  const cancellationText = rate.cancellation_policy ?? (rate.is_refundable ? "Free cancellation" : "Non-refundable");

  return (
    <div className="bg-black/28 backdrop-blur-2xl rounded-2xl border border-white/12 p-5 flex flex-col gap-3.5">
      {/* People + rate name */}
      <div className="flex flex-col items-center gap-2 pt-1">
        <div className="relative">
          <div className="size-10 rounded-full bg-white/8 border border-white/10 flex items-center justify-center">
            <Users className="size-4 text-white/50" strokeWidth={1.5} />
          </div>
          {maxOccupancy != null && (
            <span className="absolute -bottom-1 -right-1 size-4 rounded-full bg-white/12 border border-white/15 flex items-center justify-center text-[9px] text-white/60 font-medium tabular-nums leading-none">
              {maxOccupancy}
            </span>
          )}
        </div>
        <p className="font-semibold text-white/90 text-sm text-center leading-snug">{rate.name}</p>
      </div>

      {/* Meal plan */}
      {rate.meal_plan && (
        <div className="flex justify-center">
          <span className="px-2.5 py-1 text-[11px] rounded-full border border-white/10 bg-white/5 text-white/50 leading-none">
            {rate.meal_plan}
          </span>
        </div>
      )}

      {/* Cancellation */}
      <p className={`text-[11px] text-center leading-snug mt-auto ${rate.is_refundable ? "text-emerald-400/70" : "text-red-400/70"}`}>
        {cancellationText}
      </p>

      {/* Price + stepper */}
      <div className="border-t border-white/8 pt-3.5 flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-0.5">
            <span className="font-serif text-2xl text-white">€{rate.bar}</span>
            <span className="text-sm text-white/40">,-</span>
          </div>
          <p className="text-[11px] text-white/30 mt-0.5">Incl. Tax &amp; Fees</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onQtyChange(qty - 1)}
            disabled={qty === 0}
            className="size-7 rounded-full border border-white/15 bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
          >
            <Minus className="size-3" strokeWidth={2} />
          </button>
          <span className="w-5 text-center text-sm text-white/80 tabular-nums">{qty}</span>
          <button
            type="button"
            onClick={() => onQtyChange(qty + 1)}
            className="size-7 rounded-full border border-white/15 bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Plus className="size-3" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rates view ────────────────────────────────────────────────────────────────
// Rate cards are laid out in rows sized to the available width rather than a
// fixed grid. Given a column count, items are split as evenly as possible
// across the minimum number of rows — so 4 cards form a 2x2, 6 form a 3x2,
// and 5 form a 3-over-2 with the shorter row centered underneath.

const RATE_CARD_WIDTH = 190;
const RATE_CARD_GAP = 14; // px, matches gap-3.5
const MIN_RATE_COLUMNS = 1;
const MAX_RATE_COLUMNS = 4;

function distributeIntoRows<T>(items: T[], columns: number): T[][] {
  if (items.length === 0) return [];
  const rows = Math.ceil(items.length / Math.max(1, columns));
  const base = Math.floor(items.length / rows);
  const remainder = items.length % rows;

  const result: T[][] = [];
  let cursor = 0;
  for (let row = 0; row < rows; row++) {
    const size = base + (row < remainder ? 1 : 0);
    result.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return result;
}

function useAvailableColumns(cardWidth: number, gap: number, min: number, max: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(max);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const fit = Math.floor((width + gap) / (cardWidth + gap));
      setColumns(Math.min(max, Math.max(min, fit)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cardWidth, gap, min, max]);

  return { ref, columns };
}

type RatesViewProps = {
  rooms: DbRoom[];
  activeIndex: number;
  onNavigate: (i: number) => void;
};

function RatesView({ rooms, activeIndex, onNavigate }: RatesViewProps) {
  const count = rooms.length;
  const room = rooms[activeIndex];
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const { ref: gridRef, columns } = useAvailableColumns(RATE_CARD_WIDTH, RATE_CARD_GAP, MIN_RATE_COLUMNS, MAX_RATE_COLUMNS);

  const setQty = useCallback((id: string, val: number) => {
    if (val < 0) return;
    setQuantities((q) => ({ ...q, [id]: val }));
  }, []);

  const rows = distributeIntoRows(room.rate_plans, columns);

  return (
    <div className="flex flex-col select-none">
      <div className="px-4 sm:px-8 md:px-12 py-6 max-w-6xl mx-auto w-full">
        {/* Transparent container — sits over the blurred image from RoomsCarousel */}
        <div
          className="relative rounded-3xl overflow-hidden"
          style={{ height: "min(72vh, 680px)" }}
        >
          {/* Tiles: pushed right of the sidebar (left-5 + sidebar width + gap) */}
          <div
            ref={gridRef}
            className="absolute inset-0 overflow-y-auto [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-thumb]:bg-white/10"
            style={{ paddingLeft: "calc(min(28%, 296px) + 2.5rem)", paddingTop: "1.25rem", paddingRight: "1.25rem", paddingBottom: "1.25rem" }}
          >
            <div className="flex flex-col gap-3.5 min-h-full justify-center">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-3.5 justify-center">
                  {row.map((rate) => (
                    <div key={rate.id} style={{ width: RATE_CARD_WIDTH }} className="shrink-0 flex">
                      <RateCard
                        rate={rate}
                        maxOccupancy={room.max_occupancy}
                        qty={quantities[rate.id] ?? 0}
                        onQtyChange={(v) => setQty(rate.id, v)}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <RoomNav activeIndex={activeIndex} count={count} onNavigate={onNavigate} />
    </div>
  );
}

// ── Section export ────────────────────────────────────────────────────────────

export function RoomsSection({ rooms }: { rooms: DbRoom[] }) {
  const [viewMode, setViewMode] = useState<ViewMode>("images");
  const [activeIndex, setActiveIndex] = useState(0);
  const [liked, setLiked] = useState<Set<number>>(new Set());

  const toggleLike = useCallback(() => {
    setLiked((prev) => {
      const s = new Set(prev);
      if (s.has(activeIndex)) s.delete(activeIndex);
      else s.add(activeIndex);
      return s;
    });
  }, [activeIndex]);

  if (rooms.length === 0) return null;

  const sharedSidebarProps = {
    liked,
    onToggleLike: toggleLike,
    onViewRates: () => setViewMode("rates"),
  };

  return (
    <section id="rooms" className="bg-[#111111] border-t border-white/6 flex flex-col pt-10 pb-4">
      <div className="text-center px-4 mb-6 shrink-0">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-3">Accommodations</p>
        <h2 className="font-serif text-4xl sm:text-5xl">Rooms &amp; Suites</h2>
      </div>

      <div className="flex justify-center mb-2 shrink-0">
        <div className="flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/8">
          {(["images", "rates"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setViewMode(v)}
              className={`px-5 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                viewMode === v
                  ? "bg-white text-black"
                  : "text-white/45 hover:text-white/70"
              }`}
            >
              {v === "images" ? "Images" : "Rates"}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <RoomsCarousel
          rooms={rooms}
          activeIndex={activeIndex}
          onNavigate={setActiveIndex}
          viewMode={viewMode}
          {...sharedSidebarProps}
        />
        <motion.div
          className="absolute inset-0"
          style={{ pointerEvents: viewMode === "rates" ? "auto" : "none" }}
          animate={{ opacity: viewMode === "rates" ? 1 : 0 }}
          initial={false}
          transition={{ duration: 0.38, ease: "easeInOut" }}
        >
          <RatesView
            rooms={rooms}
            activeIndex={activeIndex}
            onNavigate={setActiveIndex}
          />
        </motion.div>
      </div>
    </section>
  );
}
