"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Coffee, Utensils, Landmark, Waves, ShoppingBag, TreePine, Train, Plane, Navigation, BedDouble, ConciergeBell, Sparkles, Check, Heart, Dumbbell, Leaf, Flame, Wine, Car, Anchor, Images, X, LogIn, LogOut, XCircle, CreditCard, Baby, Dog, AlertCircle, Clock, Droplets, ChefHat, Trophy } from "lucide-react";
import { Nav } from "@/components/nav";
import { type HotelCardData } from "@/components/search/HotelCard";
import type { HotelPageData } from "@/app/api/query/pr/route";
import { Map, MapMarker, MarkerContent } from "@/components/ui/map";
import FocusOverlay from "@/components/plug-in/FocusOverlay";

const ROOM_CARDS: HotelCardData[] = [
  {
    id: "3104936b-2dd8-4de0-9a86-1aa5dd8f2b53",
    name: "Jumeirah Capri Palace",
    slug: "jumeirah-capri-palace",
    distance: "1.2 Kilometers to City Center",
    rating: 8.0,
    reviews: 324,
    price: 248,
    tags: ["Lake View", "Free Wi-Fi", "Incl. Breakfast", "Free Cancellation", "Wellness"],
    images: ["Jumeirah.avif", "Jumeirah-1.avif", "Jumeirah-2.avif"],
    description: {
      type: "Suite",
      bed: "1 King Bed",
      size: "100 m²",
    },
  },
  {
    id: "0083243e-4ba1-471a-bbda-c8140c4a8998",
    name: "Hotel de la Paix",
    slug: "hotel-de-la-paix",
    distance: "1.2 Kilometers to City Center",
    rating: 7.8,
    reviews: 654,
    price: 323,
    tags: ["Paris", "Luxury", "Incl. Dinner", "Eiffeltower View", "Rain Shower"],
    images: ["Jumeirah.avif"],
    description: {
      type: "Deluxe",
      bed: "1 King Bed",
      size: "100 m²",
    },
  },
  {
    id: "0095782c-bea6-4097-86a5-bb632c824046",
    name: "Amsterdam Grand Hotel",
    slug: "amsterdam-grand-hotel",
    distance: "1.2 Kilometers to City Center",
    rating: 9.3,
    reviews: 987,
    price: 128,
    tags: ["Amsterdam", "Pride Voucher", "Butler", "High-end Luxury", "Member Discount"],
    images: ["Jumeirah.avif"],
    description: {
      type: "Standard",
      bed: "1 King Bed",
      size: "100 m²",
    },
  },
];

const AMENITY_CATEGORIES = [
  {
    label: "Room & Comfort",
    items: [
      { icon: BedDouble, label: "king bed" },
      { icon: Droplets, label: "rain shower" },
      { icon: Coffee, label: "espresso machine" },
      { icon: Wine, label: "mini bar" },
      { icon: BedDouble, label: "pillow menu" },
      { icon: Leaf, label: "aromatherapy" },
    ],
  },
  {
    label: "Dining",
    items: [
      { icon: Utensils, label: "fine dining" },
      { icon: Wine, label: "rooftop bar" },
      { icon: Utensils, label: "in-room dining" },
      { icon: ChefHat, label: "private chef" },
    ],
  },
  {
    label: "Wellness & Sport",
    items: [
      { icon: Dumbbell, label: "fitness centre" },
      { icon: Leaf, label: "yoga terrace" },
      { icon: Sparkles, label: "spa & wellness" },
      { icon: Flame, label: "turkish bath" },
      { icon: Flame, label: "sauna" },
    ],
  },
  {
    label: "Pool & Outdoors",
    items: [
      { icon: Waves, label: "infinity pool" },
      { icon: Waves, label: "private beach" },
      { icon: Trophy, label: "tennis court" },
      { icon: Anchor, label: "water sports" },
    ],
  },
  {
    label: "Services",
    items: [
      { icon: ConciergeBell, label: "concierge 24h" },
      { icon: Car, label: "airport transfer" },
      { icon: Anchor, label: "yacht charter" },
      { icon: ConciergeBell, label: "butler service" },
    ],
  },
];

const AMENITIES = AMENITY_CATEGORIES.flatMap((c) => c.items);

const AMENITIES_PREVIEW = 10;
const PILLS_PER_ROW = 5;

const NAV_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "rooms", label: "Rooms" },
  { id: "policies", label: "Policies" },
  { id: "location", label: "Location" },
  { id: "book", label: "Footnote" },
] as const;

function ScrollSpy() {
  const [active, setActive] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const THRESHOLD = window.innerHeight * 0.35;

    const update = () => {
      const hero = document.getElementById("hero");
      if (hero) {
        setVisible(hero.getBoundingClientRect().bottom < window.innerHeight * 0.1);
      }

      let current: string | null = null;
      for (const { id } of NAV_SECTIONS) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= THRESHOLD) current = id;
      }
      setActive(current);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.nav
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed left-5 top-1/2 -translate-y-1/2 z-40 flex-col items-start gap-3 hidden md:flex"
          aria-label="Page sections"
        >
          {NAV_SECTIONS.map(({ id, label }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => scrollTo(id)}
                className="group flex items-center gap-2.5"
                aria-label={`Go to ${label}`}
              >
                <span
                  className={`block rounded-full transition-all duration-300 ${
                    isActive
                      ? "w-5 h-1.5 bg-white"
                      : "w-1.5 h-1.5 bg-white/30 group-hover:bg-white/55"
                  }`}
                />
                <span
                  className={`text-xs tracking-[0.12em] uppercase transition-all duration-200 ${
                    isActive
                      ? "text-white/70 opacity-100"
                      : "text-white/0 group-hover:text-white/50 opacity-0 group-hover:opacity-100"
                  }`}
                  style={{ transitionProperty: "opacity, color" }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

const HIGHLIGHTS = [
  { icon: Waves, label: "Private Beach", distance: "50 m" },
  { icon: Utensils, label: "Il Corallo Restaurant", distance: "120 m" },
  { icon: Coffee, label: "Caffè Portoferraio", distance: "400 m" },
  { icon: Landmark, label: "Napoleonic Museum", distance: "1.2 km" },
  { icon: ShoppingBag, label: "Old Town Market", distance: "1.5 km" },
  { icon: TreePine, label: "Monte Capanne Park", distance: "3.8 km" },
  { icon: Train, label: "Portoferraio Pier", distance: "2.1 km" },
  { icon: Plane, label: "Marina di Campo Airport", distance: "18 km" },
];

function GalleryDialog({ images, initialIndex, onClose }: { images: string[]; initialIndex: number; onClose: () => void }) {
  const [current, setCurrent] = useState(initialIndex);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setCurrent((i) => (i - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") setCurrent((i) => (i + 1) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md"
        onClick={onClose}
      >
        <button
          type="button"
          aria-label="Close gallery"
          onClick={onClose}
          className="absolute top-5 right-5 size-10 flex items-center justify-center rounded-full bg-white/10 border border-white/15 text-white/60 hover:text-white hover:bg-white/20 transition-colors z-10"
        >
          <X className="size-5" strokeWidth={1.8} />
        </button>

        <div className="relative flex items-center justify-center w-full h-full px-16" onClick={(e) => e.stopPropagation()}>
          <AnimatePresence mode="wait">
            <motion.img
              key={current}
              src={images[current]}
              alt={`Gallery image ${current + 1}`}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="max-h-[82vh] max-w-full object-contain rounded-xl shadow-2xl select-none"
              draggable={false}
            />
          </AnimatePresence>

          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                onClick={() => setCurrent((i) => (i - 1 + images.length) % images.length)}
                className="absolute left-4 size-11 flex items-center justify-center rounded-full bg-black/40 border border-white/15 text-white/60 hover:text-white hover:bg-black/60 transition-colors"
              >
                <ChevronLeft className="size-5" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                aria-label="Next image"
                onClick={() => setCurrent((i) => (i + 1) % images.length)}
                className="absolute right-4 size-11 flex items-center justify-center rounded-full bg-black/40 border border-white/15 text-white/60 hover:text-white hover:bg-black/60 transition-colors"
              >
                <ChevronRight className="size-5" strokeWidth={1.8} />
              </button>
            </>
          )}

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to image ${i + 1}`}
                onClick={() => setCurrent(i)}
                className={`rounded-full transition-all duration-300 ${i === current ? "w-5 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/35 hover:bg-white/60"}`}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function GalleryBar({ images }: { images: string[] }) {
  const [paused, setPaused] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogIndex, setDialogIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  if (!images.length) return null;

  // Duplicate enough times to fill a seamless loop
  const repeated = [...images, ...images, ...images, ...images];

  // Fixed scroll speed regardless of image count (px/s)
  const SCROLL_SPEED = 60;
  const itemWidth = 195 + 8; // tile width + gap-2
  const scrollDistance = images.length * 2 * itemWidth; // -50% of 4× set
  const scrollDuration = scrollDistance / SCROLL_SPEED;

  const openDialog = (index: number) => {
    setDialogIndex(index % images.length);
    setDialogOpen(true);
  };

  return (
    <>
      <div
        className="relative w-full overflow-hidden"
        style={{ height: 130 }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Scrolling track */}
        <div
          ref={trackRef}
          className="flex gap-2 absolute left-0 top-0 h-full"
          style={{
            animation: `gallery-scroll ${scrollDuration}s linear infinite`,
            animationPlayState: paused ? "paused" : "running",
            width: "max-content",
            filter: paused ? "blur(7px) brightness(0.6)" : undefined,
            transition: "filter 0.25s ease",
          }}
        >
          {repeated.map((url, i) => (
            <div
              key={i}
              className="relative h-full shrink-0 cursor-pointer overflow-hidden rounded-lg"
              style={{ width: 195 }}
              onClick={() => openDialog(i)}
            >
              <img
                src={url}
                alt={`Property image ${(i % images.length) + 1}`}
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>
          ))}
        </div>

        {/* Hover overlay */}
        {paused && (
          <div
            className="absolute inset-0 flex items-center justify-center z-10 cursor-pointer"
            onClick={() => openDialog(0)}
          >
            <div className="flex items-center gap-3 bg-black/55 backdrop-blur-md rounded-full px-6 py-3 text-white pointer-events-none select-none">
              <Images className="size-5" strokeWidth={1.6} />
              <span className="text-lg font-medium tracking-wide">View images</span>
            </div>
          </div>
        )}

        {/* Edge fade masks */}
        <div className="absolute inset-y-0 left-0 w-20 bg-linear-to-r from-[#0a0a0a] to-transparent pointer-events-none z-10" />
        <div className="absolute inset-y-0 right-0 w-20 bg-linear-to-l from-[#0a0a0a] to-transparent pointer-events-none z-10" />
      </div>

      <style>{`
        @keyframes gallery-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>

      {dialogOpen && (
        <GalleryDialog
          images={images}
          initialIndex={dialogIndex}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}

const slideVariants = {
  enter: (d: number) => ({ x: d > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d > 0 ? "-60%" : "60%", opacity: 0, scale: 0.96 }),
};

function RoomsCarousel({ rooms }: { rooms: HotelCardData[] }) {
  const count = rooms.length;
  const [activeIndex, setActiveIndex] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [liked, setLiked] = useState<Set<number>>(new Set());
  const [dir, setDir] = useState(1);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

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

  const room = rooms[activeIndex];
  const imageCount = room.images.length;

  const prevImage = useCallback(() => setImageIndex((i) => (i - 1 + imageCount) % imageCount), [imageCount]);
  const nextImage = useCallback(() => setImageIndex((i) => (i + 1) % imageCount), [imageCount]);

  const navigate = useCallback((idx: number) => {
    setDir(idx > activeIndex ? 1 : -1);
    setActiveIndex(idx);
    setImageIndex(0);
  }, [activeIndex]);

  const prev = useCallback(() => navigate((activeIndex - 1 + count) % count), [navigate, activeIndex, count]);
  const next = useCallback(() => navigate((activeIndex + 1) % count), [navigate, activeIndex, count]);

  useEffect(() => {
    if (hovered || !visible) return;
    const id = setTimeout(() => {
      if (imageIndex < imageCount - 1) {
        setImageIndex((i) => i + 1);
      } else {
        next();
      }
    }, 3000);
    return () => clearTimeout(id);
  }, [hovered, visible, imageIndex, imageCount, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  const toggleLike = useCallback(() => {
    setLiked((prev) => {
      const s = new Set(prev);
      if (s.has(activeIndex)) s.delete(activeIndex);
      else s.add(activeIndex);
      return s;
    });
  }, [activeIndex]);

  return (
    <div className="flex flex-col select-none">
      {/* Card stage */}
      <div className="px-4 sm:px-8 md:px-[8%] lg:px-[10%] py-[3%]">
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
              {/* Background image with cross-fade on image change */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={imageIndex}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.55 }}
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url('https://images.openbookings.co/${room.id}/${room.images[imageIndex]}')` }}
                />
              </AnimatePresence>

              {/* Gradient overlays */}
              <div className="absolute inset-0 bg-linear-to-r from-black/45 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-linear-to-t from-black/55 via-transparent to-black/15" />

              {/* Image selector — bottom left */}
              {imageCount > 1 && (
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
                        className={`rounded-full transition-all duration-300 ${i === imageIndex
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

              {/* ── Info panel ── */}
              <AnimatePresence>
                {panelOpen ? (
                  <motion.div
                    key="panel"
                    initial={{ opacity: 0, x: 32 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 32 }}
                    transition={{ duration: 0.28, ease: "easeOut" }}
                    className="absolute top-5 right-5 bottom-5 w-[min(28%,296px)] bg-black/28 backdrop-blur-2xl rounded-2xl border border-white/12 flex flex-col overflow-hidden"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {/* Collapse button */}
                    <button
                      type="button"
                      aria-label="Collapse info"
                      onClick={() => setPanelOpen(false)}
                      className="absolute top-3.5 right-3.5 size-7 flex items-center justify-center rounded-full bg-white/8 border border-white/10 text-white/40 hover:text-white/75 transition-colors z-10"
                    >
                      <ChevronRight className="size-3.5" strokeWidth={2} />
                    </button>

                    {/* Scrollable content */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-5 [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-thumb]:bg-white/10">
                      {/* Name + type */}
                      <div className="pr-8">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/35 mb-1.5">
                          {room.description.type}
                        </p>
                        <h3 className="font-serif text-2xl sm:text-[1.7rem] text-white leading-snug">
                          {room.name}
                        </h3>
                      </div>

                      {/* Stats grid */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/35 mb-1">Bed</p>
                          <p className="text-sm text-white/80 font-medium leading-snug">{room.description.bed}</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/35 mb-1">Size</p>
                          <p className="text-sm text-white/80 font-medium">{room.description.size}</p>
                        </div>
                      </div>

                      {/* Highlights */}
                      <div className="flex flex-col gap-2.5">
                        <p className="text-xs uppercase tracking-[0.15em] text-white/30">Highlights</p>
                        {room.tags.slice(0, 5).map((tag) => (
                          <div key={tag} className="flex items-center gap-2.5">
                            <Check className="size-3 text-white/35 shrink-0" strokeWidth={2.5} />
                            <span className="text-sm text-white/75">{tag}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Footer: price + actions */}
                    <div className="px-5 pt-4 pb-5 border-t border-white/8 flex flex-col gap-3 shrink-0">
                      <div>
                        <p className="text-xs text-white/35">From</p>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-serif text-3xl text-white">€{room.price}</span>
                          <span className="text-sm text-white/35">/ night</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          aria-label="Like this room"
                          onClick={toggleLike}
                          className={`size-11 flex items-center justify-center rounded-xl border transition-all ${liked.has(activeIndex)
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
                          className="flex-1 h-11 bg-white text-black font-semibold text-sm rounded-xl hover:bg-white/90 transition-colors"
                        >
                          Book
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  /* Info icon — collapsed state */
                  <motion.button
                    key="info-btn"
                    type="button"
                    aria-label="Show room info"
                    initial={{ opacity: 0, scale: 0.75 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.75 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => setPanelOpen(true)}
                    className="absolute bottom-6 right-6 size-11 flex items-center justify-center rounded-full bg-black/35 backdrop-blur-xl border border-white/15 text-white/70 hover:text-white hover:bg-black/50 transition-colors z-10"
                  >
                    <span className="font-serif italic text-xl font-light leading-none select-none pb-px">i</span>
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-center gap-6 py-6 shrink-0">
        <button
          type="button"
          aria-label="Previous room"
          onClick={prev}
          disabled={activeIndex === 0}
          className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/60 transition-colors hover:bg-white/16 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="size-5" strokeWidth={1.8} />
        </button>

        <div className="flex items-center gap-2.5">
          {rooms.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to room ${i + 1}`}
              onClick={() => navigate(i)}
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
          onClick={next}
          disabled={activeIndex === rooms.length - 1}
          className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/60 transition-colors hover:bg-white/16 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <ChevronRight className="size-5" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

export default function HotelPage({
  params,
}: {
  params: Promise<{ hotel_slug: string }>;
}) {
  const { hotel_slug } = use(params);
  const [authError, setAuthError] = useState<string | null>(null);
  const [hero, setHero] = useState<HotelPageData | null>(null);
  const [amenitiesExpanded, setAmenitiesExpanded] = useState(false);
  const [amenitiesOverlayOpen, setAmenitiesOverlayOpen] = useState(false);
  const [businessDetailsOpen, setBusinessDetailsOpen] = useState(false);

  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
  const MTStyleKey = process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID;

  useEffect(() => {
    fetch(`/api/query/pr?slug=${encodeURIComponent(hotel_slug)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: HotelPageData | null) => setHero(data))
      .catch(() => { });
  }, [hotel_slug]);

  return (
    <div className="bg-[#0a0a0a] text-white">
      <Nav authError={authError} onDismissAuthError={() => setAuthError(null)} />
      <ScrollSpy />
      {/* ── Section 1: Hero — exactly one viewport tall ── */}
      <section id="hero" className="relative h-screen overflow-hidden bg-[#0a0a0a]">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url('${hero?.hero_image_url}')` }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 20%, rgba(0,0,0,0.2) 45%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.3) 100%)",
            }}
          />
        </div>

        {/* Bottom row: title left, CTA right */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-4 sm:px-8 md:px-14 pb-14 sm:pb-16">
          <div style={{ textShadow: "0 2px 24px rgba(0,0,0,0.85), 0 1px 6px rgba(0,0,0,0.6)" }}>
            <h1 className="font-serif text-6xl sm:text-7xl md:text-8xl tracking-tight mb-2 select-none">
              {hero?.name}
            </h1>
            <p className="text-3xl sm:text-4xl text-white/80 font-semibold select-none pl-3">
              {hero?.subtitle}
            </p>
          </div>

          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              className="min-w-44 max-w-xs w-full bg-black/30 backdrop-blur-2xl rounded-xl border border-white/20 shadow-2xl px-6 py-4 flex items-center justify-center hover:bg-black/50 transition-colors"
            >
              <span className="text-xl sm:text-2xl font-serif whitespace-nowrap text-white">
                Book Now
              </span>
            </button>

            <div className="flex flex-col items-center">
              <span className="text-base text-white/60 select-none">Scroll for more</span>
              <svg
                className="w-8 h-5 text-white/60"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 48 20"
                aria-hidden="true"
              >
                <path d="M8 6l16 8 16-8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* ── Gallery bar ── */}
      {hero?.gallery_images?.length ? (
        <div className="py-4 bg-[#0a0a0a]">
          <GalleryBar images={hero.gallery_images} />
        </div>
      ) : null}

      {/* ── Section 2: Overview ── */}
      <section id="overview" className="bg-[#0a0a0a]">
        <div className="px-4 sm:px-8 md:px-24 py-16 sm:py-20 max-w-6xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-6 text-center">Overview</p>
          <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl leading-tight mb-16 text-center whitespace-nowrap">
            Where stillness meets the sea
          </h2>

          {/* Review score + short intro */}
          <div className="grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-12 lg:gap-16 items-start mb-14">
            {/* Review score */}
            <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-7">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="font-serif text-3xl text-white">8.9</span>
                  <div className="flex flex-col items-start">
                    <span className="text-sm text-white/65">Excellent</span>
                    <span className="text-xs text-white/35">324 reviews</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-white/6" />

              <div className="flex flex-col gap-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/30">Recent Review</p>
                <blockquote className="text-sm text-white/70 leading-relaxed italic">
                  &ldquo;The most breathtaking sunsets I have ever experienced. Every detail was considered — from the thread count to the scent of the towels. We will return.&rdquo;
                </blockquote>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/30">— Maria K., May 2025</span>
                  <span className="flex items-center gap-1 bg-blue-500/12 text-blue-400 text-sm font-semibold rounded-lg px-2.5 py-1 border border-blue-500/15">
                    9.4
                  </span>
                </div>
              </div>
            </div>

            {/* Short intro */}
            <div className="flex flex-col gap-8 text-white/75 text-lg leading-relaxed pt-2">
              <p>
                Nestled along a secluded coastline, {hero?.name} is a sanctuary built for those who seek
                beauty without compromise. Every surface, every view, every moment has been considered
                with quiet precision. Guests arrive to discover that luxury here is not loud — it is the sound of water at
                dusk, a perfectly rested morning, and a team that anticipates before you ask. This is
                your home for as long as you choose to stay.
              </p>
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-white/8 mb-8" />

          {/* Amenities — card rows */}
          <div className="flex flex-col gap-3">
            {(() => {
              const overflow = !amenitiesExpanded && AMENITIES.length > AMENITIES_PREVIEW;
              const sliceEnd = overflow ? AMENITIES_PREVIEW : AMENITIES.length;
              const visible = AMENITIES.slice(0, sliceEnd);
              const rows: typeof AMENITIES[] = [];
              for (let i = 0; i < visible.length; i += PILLS_PER_ROW) {
                rows.push(visible.slice(i, i + PILLS_PER_ROW));
              }
              const remaining = AMENITIES.length - sliceEnd;

              return (
                <>
                  {rows.map((row, ri) => (
                    <div key={ri} className="flex gap-3">
                      {row.map((amenity) => {
                        const { icon: Icon, label } = amenity;
                        return (
                          <div
                            key={label}
                            className="flex items-center gap-3 px-4 py-4 rounded-xl border border-white/8 bg-white/3 flex-1 min-w-0"
                          >
                            <Icon className="size-5 text-white/45 shrink-0" strokeWidth={1.5} />
                            <span className="text-sm text-white/70 truncate">{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {overflow && (
                    <button
                      type="button"
                      onClick={() => setAmenitiesOverlayOpen(true)}
                      className="mt-1 self-center text-xs uppercase tracking-[0.18em] text-white/50 hover:text-white/75 transition-colors"
                    >
                      +{remaining} more amenities
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </section>

      {/* ── Section 3: Rooms ── */}
      <section id="rooms" className="bg-[#111111] border-t border-white/6 flex flex-col pt-10 pb-4">
        <div className="text-center px-4 mb-6 shrink-0">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-3">Accommodations</p>
          <h2 className="font-serif text-4xl sm:text-5xl">Rooms &amp; Suites</h2>
        </div>
        <RoomsCarousel rooms={ROOM_CARDS} />
      </section>




      {/* ── Section 5: House Rules ── */}
      <section id="policies" className="bg-[#0a0a0a] border-t border-white/6 py-28 sm:py-36">
        <div className="px-4 sm:px-8 md:px-16 max-w-7xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-6 text-center">Policies</p>
          <h2 className="font-serif text-4xl sm:text-5xl mb-16 text-center">House Rules</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            {/* Check-in / Check-out */}
            <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30">Arrival &amp; Departure</p>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/8 text-white/40">
                    <LogIn className="size-4" strokeWidth={1.6} />
                  </span>
                  <div>
                    <p className="text-sm text-white/80 font-medium mb-0.5">Check-in</p>
                    <p className="text-sm text-white/65">From 15:00 — Early check-in subject to availability</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/8 text-white/40">
                    <LogOut className="size-4" strokeWidth={1.6} />
                  </span>
                  <div>
                    <p className="text-sm text-white/80 font-medium mb-0.5">Check-out</p>
                    <p className="text-sm text-white/65">Until 12:00 — Late check-out available on request</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/8 text-white/40">
                    <Clock className="size-4" strokeWidth={1.6} />
                  </span>
                  <div>
                    <p className="text-sm text-white/80 font-medium mb-0.5">Reception</p>
                    <p className="text-sm text-white/65">24-hour front desk — no check-in cut-off</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Cancellation & Prepayment */}
            <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30">Cancellation &amp; Prepayment</p>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/8 text-white/40">
                    <XCircle className="size-4" strokeWidth={1.6} />
                  </span>
                  <div>
                    <p className="text-sm text-white/80 font-medium mb-0.5">Free Cancellation</p>
                    <p className="text-sm text-white/65">Cancel up to 7 days before arrival at no charge. Cancellations within 7 days incur the first night&apos;s charge.</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/8 text-white/40">
                    <CreditCard className="size-4" strokeWidth={1.6} />
                  </span>
                  <div>
                    <p className="text-sm text-white/80 font-medium mb-0.5">Prepayment</p>
                    <p className="text-sm text-white/65">Required to secure your booking. Full authorization needed before arrival.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-12">
            {/* Children & Beds */}
            <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30">Children &amp; Beds</p>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Baby className="size-4 shrink-0 text-white/35" strokeWidth={1.6} />
                  <p className="text-sm text-white/65">Children of all ages welcome</p>
                </div>
                <div className="flex items-center gap-3">
                  <BedDouble className="size-4 shrink-0 text-white/35" strokeWidth={1.6} />
                  <p className="text-sm text-white/65">Cots available on request — free of charge</p>
                </div>
                <div className="flex items-center gap-3">
                  <BedDouble className="size-4 shrink-0 text-white/35" strokeWidth={1.6} />
                  <p className="text-sm text-white/65">Extra beds available — €60 per night</p>
                </div>
              </div>
            </div>

            {/* Payment Methods */}
            <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30">Payment Methods</p>
              <div className="flex flex-wrap gap-3">
                {[
                  { src: "https://cdn.openbookings.co/media/visa.png", alt: "Visa" },
                  { src: "https://cdn.openbookings.co/media/mastercard.png", alt: "Mastercard" },
                  { src: "https://cdn.openbookings.co/media/amex.svg", alt: "American Express" },
                  { src: "https://cdn.openbookings.co/media/wero-1.svg", alt: "Wero" },
                  { src: "https://cdn.openbookings.co/media/applepay.svg", alt: "Apple Pay" },
                ].map(({ src, alt }) => (
                  <div key={alt} className="flex items-center justify-center h-9 w-16 rounded-lg bg-white/6 border border-white/10">
                    <img src={src} alt={alt} className="h-5 w-10 object-contain" draggable={false} />
                  </div>
                ))}
                {/* Cash — hotel-only, not a card */}
                <div className="group relative flex items-center justify-center h-9 w-16 rounded-lg bg-white/6 border border-white/10" style={{ cursor: "help" }}>
                  <span className="text-xs font-medium text-white/55 tracking-wide border-b border-dashed border-white/30">Cash</span>
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[180px] rounded-lg bg-[#1a1a1a] border border-white/12 px-3 py-2 text-xs text-white/70 leading-snug opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 text-center">
                    Payment method only available at the hotel
                  </div>
                </div>
              </div>
            </div>

            {/* Other */}
            <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30">Other</p>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <AlertCircle className="size-4 shrink-0 text-white/35" strokeWidth={1.6} />
                  <p className="text-sm text-white/65">Minimum check-in age: 18 years</p>
                </div>
                <div className="flex items-center gap-3">
                  <Dog className="size-4 shrink-0 text-white/35" strokeWidth={1.6} />
                  <p className="text-sm text-white/65">Pets not allowed</p>
                </div>
              </div>
            </div>
          </div>

          {/* Fine Print */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-7">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-5">The Not-So-Small Print</p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-2.5 text-sm text-white/60 leading-relaxed">
              {[
                "A security deposit of €500 is required upon arrival and will be fully refunded within 7 days of check-out, subject to room inspection.",
                "Government-issued photo ID and a valid credit card are required at check-in. Guests must be at least 18 years old.",
                "Quiet hours are observed between 22:00 and 08:00. Events and gatherings require prior written approval from management.",
                "The property reserves the right to pre-authorise the provided credit card prior to arrival. Rates displayed are inclusive of applicable taxes and service charges.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 size-1 rounded-full bg-white/25 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="border-t border-white/6 mt-6 pt-6">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-3">Legal information</p>
              <p className="text-sm text-white/60 leading-relaxed">
                OpenBookings acts as Online Travel Agent and payment intermediary on behalf of {hero?.name ?? "this property"}.
                <br />Your reservation is a direct contract with {hero?.name ?? "this property"}. {" "}
                <button
                  type="button"
                  onClick={() => setBusinessDetailsOpen(true)}
                  className="text-white/45 hover:text-white/70 transition-colors underline underline-offset-3 decoration-white/20 hover:decoration-white/45"
                >
                  View business details →
                </button>
              </p>
            </div>

            <div className="border-t border-white/6 mt-6 pt-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
              <a
                href="https://openbookings.co"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/45 hover:text-white/70 transition-colors underline underline-offset-3 decoration-white/20 hover:decoration-white/45"
              >
                Cancellation policy →
              </a>
              
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 4: Location ── */}
      <section id="location" className="bg-[#111111] border-t border-white/6 py-28 sm:py-36">
        <div className="px-4 sm:px-8 md:px-16 max-w-7xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-6 text-center">Find us</p>
          <h2 className="font-serif text-4xl sm:text-5xl mb-10 text-center">Location</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 items-stretch md:h-80 overflow-hidden">
            <div className="flex flex-col text-white/75 text-lg leading-relaxed">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-4">About</p>
              <p>
                Situated just 20 minutes from the international airport, yet a world apart from
                the ordinary. Our address is one of the region&apos;s best-kept secrets.
              </p>
              <div className="mt-auto pt-8 flex items-center gap-4">
                <button
                  type="button"
                  aria-label="Get directions"
                  className="flex size-10 items-center justify-center rounded-full border border-white/12 bg-white/6 text-white/40 hover:bg-white/12 hover:text-white/80 transition-colors"
                >
                  <Navigation className="size-4" strokeWidth={1.6} />
                </button>
                <div className="space-y-1 text-white/60 text-sm">
                  <p>Via della Quiete 1</p>
                  <p>57037 Portoferraio, Italy</p>
                </div>
              </div>

            </div>
            {/* Map */}
            <div className="h-full min-h-64 rounded-2xl overflow-hidden border border-white/8">
              {typeof hero?.lon === "number" && typeof hero?.lat === "number" && (
                <div className="relative w-full h-full pointer-events-none select-none">
                  <Map
                    styles={maptilerKey && MTStyleKey ? {
                      dark: `https://api.maptiler.com/maps/${MTStyleKey}/style.json?key=${maptilerKey}`,
                      light: `https://api.maptiler.com/maps/${MTStyleKey}/style.json?key=${maptilerKey}`,
                    } : undefined}
                    center={[hero.lon, hero.lat]}
                    zoom={14}
                    attributionControl={false}
                    interactive={false}
                  >
                    <MapMarker longitude={hero.lon} latitude={hero.lat}>
                      <MarkerContent>
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 24 30" fill="none">
                          <path d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 21 9 21s9-14.25 9-21c0-4.97-4.03-9-9-9z" fill="oklch(62% 0.21 268)" />
                          <circle cx="12" cy="9" r="3.5" fill="white" />
                        </svg>
                      </MarkerContent>
                    </MapMarker>
                  </Map>
                </div>

              )}
            </div>
            {/* Highlights */}
            <div className="flex flex-col min-h-0">
              <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-4">Nearby</p>
              <div className="flex-1 overflow-y-auto space-y-px [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
                {HIGHLIGHTS.map(({ icon: Icon, label, distance }) => (
                  <div
                    key={label}
                    className="flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-white/4 transition-colors group"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/6 text-white/40 group-hover:text-white/60 transition-colors">
                      <Icon className="size-3.5" strokeWidth={1.6} />
                    </span>
                    <span className="flex-1 text-sm text-white/80 group-hover:text-white transition-colors truncate">
                      {label}
                    </span>
                    <span className="text-xs text-white/30 shrink-0 tabular-nums">{distance}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 6: Book CTA ── */}
      <section id="book" className="bg-[#0a0a0a] border-t border-white/6">
        <div className="px-4 sm:px-8 md:px-20 py-28 max-w-7xl mx-auto">
          {/* Logos row — collaboration style */}
          <div className="flex items-center justify-center gap-8 mb-8">
            {hero?.logo_image_url ? (
              <img
                src={hero.logo_image_url}
                alt={`${hero.name} logo`}
                className="h-auto w-28 object-contain"
              />
            ) : (
              <span className="text-white/70 text-base font-medium tracking-wide">{hero?.name}</span>
            )}
            <span className="flex items-center justify-center h-14 text-white/20 text-3xl font-thin select-none leading-none">×</span>
            <img
              src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
              alt="OpenBookings"
              className="h-auto w-28 object-contain"
            />
          </div>

          <div className="max-w-xl mx-auto mt-10 pb-10 border-t border-white/6"></div>

          {/* CTA */}
          <div className="text-center ">
            <h2 className="font-serif text-5xl sm:text-6xl md:text-7xl mb-6">Ready to arrive?</h2>
            <p className="text-white/70 text-xl mb-12 max-w-lg mx-auto">
              Reserve your stay at {hero?.name} and let us take care of the rest.
            </p>
            <button
              type="button"
              className="bg-white text-black font-semibold text-lg px-10 py-4 rounded-xl hover:bg-white/90 transition-colors"
            >
              Book Now
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0a0a0a] border-t border-white/6 px-4 sm:px-8 md:px-24 py-10 max-w-7xl mx-auto flex items-center justify-between text-white/30 text-sm">
        <span>{hero?.name}</span>
        <span>© {new Date().getFullYear()} OpenBookings</span>
      </footer>

      {/* Amenities overlay */}
      <FocusOverlay open={amenitiesOverlayOpen} onClose={() => setAmenitiesOverlayOpen(false)}>
        <div
          className="bg-[#0f0f0e] border border-white/[0.07] rounded-2xl flex flex-col overflow-hidden"
          style={{ width: "min(640px, 92vw)", maxHeight: "82vh" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-8 pt-7 pb-6 shrink-0">
            <h2 className="font-serif text-2xl text-white tracking-tight">All Amenities</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setAmenitiesOverlayOpen(false)}
              className="size-7 flex items-center justify-center text-white/25 hover:text-white/55 transition-colors"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>
          </div>

          {/* Categories */}
          <div className="flex-1 min-h-0 overflow-y-auto px-8 [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-thumb]:bg-white/10]">
            {AMENITY_CATEGORIES.map((category, ci) => (
              <div key={category.label}>
                {ci > 0 && <div className="border-t border-white/5.5" />}
                <div className="py-6">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-white/45 mb-5">{category.label}</p>
                  <div className="grid grid-cols-3 gap-x-6 gap-y-4">
                    {category.items.map(({ icon: Icon, label }) => (
                      <div key={label} className="flex items-center gap-2.5 min-w-0">
                        <Icon className="size-[15px] text-white/22 shrink-0" strokeWidth={1.4} />
                        <span className="text-[13px] text-white/60 truncate">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </FocusOverlay>

      {/* Business details overlay */}
      <FocusOverlay open={businessDetailsOpen} onClose={() => setBusinessDetailsOpen(false)}>
        <div className="bg-[#111] border border-white/10 rounded-2xl p-8 max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-thumb]:bg-white/10]">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Business Details</p>
              <h2 className="font-serif text-3xl sm:text-4xl text-white leading-tight">{hero?.name ?? "Property"}</h2>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setBusinessDetailsOpen(false)}
              className="size-9 flex items-center justify-center rounded-full bg-white/6 border border-white/10 text-white/40 hover:text-white/70 transition-colors shrink-0 mt-1"
            >
              <X className="size-4" strokeWidth={1.8} />
            </button>
          </div>

          <p className="text-sm text-white/60 leading-relaxed mb-8 border-b border-white/8 pb-8">
            OpenBookings acts as Online Travel Agent and payment intermediary on behalf of this property.
            Your reservation is a direct contract with the property operator listed below. The operator
            is responsible for the delivery of services described on this listing and is registered with the
            relevant local trade authority.
          </p>

          <div className="relative group mb-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 transition-[filter] duration-300 group-hover:blur-none blur-sm select-none group-hover:select-auto">
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Legal name</p>
                <p className="text-sm text-white/80 font-medium">{hero?.name ?? "—"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Address</p>
                <p className="text-sm text-white/80">Via della Quiete 1</p>
                <p className="text-sm text-white/80">57037 Portoferraio, Italy</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Email</p>
                <p className="text-sm text-white/80">reservations@{hero?.name?.toLowerCase().replace(/\s+/g, "") ?? "property"}.com</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Phone</p>
                <p className="text-sm text-white/80">+39 0565 944 111</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Company registration</p>
                <p className="text-sm text-white/80 font-mono tracking-wide">IT 03847210491</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">VAT number</p>
                <p className="text-sm text-white/80 font-mono tracking-wide">REA LI-92847</p>
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300 group-hover:opacity-0">
              <span className="text-xs uppercase tracking-[0.18em] text-white/45">Hover to show</span>
            </div>
          </div>

          <div className="border-t border-white/8 pt-6">
            <p className="text-xs text-white/30 leading-relaxed">
              This information is provided for transparency purposes. OpenBookings verifies operator registrations at the time of onboarding. For disputes or complaints, contact us at{" "}
              <span className="text-white/50">support@openbookings.co</span>.
            </p>
          </div>
        </div>
      </FocusOverlay>
    </div>
  );
}
