"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NAV_SECTIONS } from "./constants";

export function ScrollSpy() {
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

    const raf = requestAnimationFrame(update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update);
    };
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
