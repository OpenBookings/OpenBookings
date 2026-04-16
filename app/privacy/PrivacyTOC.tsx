"use client";

import { useEffect, useRef, useState } from "react";

const sections = [
  { id: "who-we-are", label: "1. Who we are" },
  { id: "what-we-collect", label: "2. What we collect" },
  { id: "cookies", label: "3. Cookies" },
  { id: "retention", label: "4. Retention" },
  { id: "sharing", label: "5. Data sharing" },
  { id: "security", label: "6. Security" },
  { id: "your-rights", label: "7. Your rights" },
  { id: "automated-decisions", label: "8. Automated decisions" },
  { id: "children", label: "9. Children" },
  { id: "open-source", label: "10. Open source" },
  { id: "changes", label: "11. Changes" },
  { id: "contact", label: "12. Contact" },
];

export function PrivacyTOC() {
  const [active, setActive] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const handleIntersect: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActive(entry.target.id);
        }
      }
    };

    observerRef.current = new IntersectionObserver(handleIntersect, {
      rootMargin: "-20% 0px -70% 0px",
      threshold: 0,
    });

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <nav aria-label="Table of contents">
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/30">
        On this page
      </p>
      <ul className="space-y-1">
        {sections.map(({ id, label }) => (
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
