"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Images, X, ChevronLeft, ChevronRight } from "lucide-react";

type GalleryImage = { url: string; alt_text: string | null };

function GalleryDialog({
  images,
  initialIndex,
  onClose,
}: {
  images: GalleryImage[];
  initialIndex: number;
  onClose: () => void;
}) {
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

  const { url, alt_text } = images[current];

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

        <div
          className="relative flex flex-col items-center justify-center w-full h-full px-16 gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <AnimatePresence mode="wait">
            {alt_text && (
              <motion.p
                key={`title-${current}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="text-white text-base font-medium tracking-wide text-center max-w-lg"
              >
                {alt_text}
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.img
              key={current}
              src={url}
              alt={alt_text ?? `Gallery image ${current + 1}`}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="max-h-[78vh] max-w-full object-contain rounded-xl shadow-2xl select-none"
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
                className={`rounded-full transition-all duration-300 ${
                  i === current ? "w-5 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/35 hover:bg-white/60"
                }`}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

const SCROLL_SPEED = 60; // px/s
const ITEM_WIDTH = 195 + 8; // tile + gap

export function GalleryBar({ images }: { images: GalleryImage[] }) {
  const [paused, setPaused] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogIndex, setDialogIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  if (!images.length) return null;

  const repeated = [...images, ...images, ...images, ...images];
  const scrollDistance = images.length * 2 * ITEM_WIDTH;
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
          {repeated.map((img, i) => (
            <div
              key={i}
              className="relative h-full shrink-0 cursor-pointer overflow-hidden rounded-lg"
              style={{ width: 195 }}
              onClick={() => openDialog(i)}
            >
              <img
                src={img.url}
                alt={img.alt_text ?? `Property image ${(i % images.length) + 1}`}
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>
          ))}
        </div>

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

        <div className="absolute inset-y-0 left-0 w-20 bg-linear-to-r from-[#0a0a0a] to-transparent pointer-events-none z-10" />
        <div className="absolute inset-y-0 right-0 w-20 bg-linear-to-l from-[#0a0a0a] to-transparent pointer-events-none z-10" />
      </div>

      <style>{`
        @keyframes gallery-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
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
