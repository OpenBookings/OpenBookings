"use client";

import { useEffect, useState } from "react";

type Entry = { id: string; label: string };

/**
 * Table of contents for a legal document.
 *
 * Entries are read from the rendered DOM rather than from a maintained list,
 * because that list would otherwise have to be duplicated and kept in sync for
 * every language. Each `<Section>` renders `<section id>` containing an `<h2>`,
 * so the headings are discoverable without the document declaring them twice.
 *
 * The read is deferred to an animation frame: it waits until layout has settled
 * before measuring, and it keeps the state update out of the effect body so
 * mounting does not trigger a cascading render.
 */
export function LegalTOC() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    let observer: IntersectionObserver | undefined;

    const frame = requestAnimationFrame(() => {
      const sections = Array.from(
        document.querySelectorAll<HTMLElement>("article section[id]")
      );
      if (sections.length === 0) return;

      setEntries(
        sections.map((el) => ({
          id: el.id,
          label: el.querySelector("h2")?.textContent?.trim() ?? el.id,
        }))
      );

      observer = new IntersectionObserver(
        (observed) => {
          for (const entry of observed) {
            if (entry.isIntersecting) setActive(entry.target.id);
          }
        },
        { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
      );

      sections.forEach((el) => observer?.observe(el));
    });

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <nav aria-label="Table of contents">
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/30">
        On this page
      </p>
      <ul className="space-y-1">
        {entries.map(({ id, label }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className={`block rounded-lg px-3 py-1.5 text-sm transition-all duration-150 ${
                active === id
                  ? "bg-white/10 text-white font-medium"
                  : "text-white/40 hover:text-white/70 hover:bg-white/5"
              }`}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
