"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/nav";

/** Pixels scrolled before the blur fades in: past a stray trackpad nudge, before any content reaches the nav. */
const SCROLL_THRESHOLD = 8;

/**
 * The progressive blur behind the business landing page's nav
 * (apps/business/components/business/Nav.tsx): four blur strengths, each
 * masked to its own band, so the page fades into blur under the logo and
 * profile instead of ending at a hard edge.
 */
const blurLayers = [
  {
    blur: "backdrop-blur-[24px]",
    mask: "[mask-image:linear-gradient(to_bottom,black_0%,black_20%,transparent_45%)]",
  },
  {
    blur: "backdrop-blur-[12px]",
    mask: "[mask-image:linear-gradient(to_bottom,transparent_5%,black_25%,black_40%,transparent_60%)]",
  },
  {
    blur: "backdrop-blur-[6px]",
    mask: "[mask-image:linear-gradient(to_bottom,transparent_30%,black_50%,black_60%,transparent_80%)]",
  },
  {
    blur: "backdrop-blur-[2px]",
    mask: "[mask-image:linear-gradient(to_bottom,transparent_55%,black_75%,black_85%,transparent_100%)]",
  },
];

export function NavWrapper() {
  const [authError, setAuthError] = useState<string | null>(null);
  // On from the first bit of scrolling, so nothing slides under the logo unblurred.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > SCROLL_THRESHOLD);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <>
      {/* Under the nav's logo and profile (z-20), over the page. */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-x-0 top-0 z-[15] h-16 transition-opacity duration-300 sm:h-[88px] md:h-32 ${
          scrolled ? "opacity-100" : "opacity-0"
        }`}
      >
        {blurLayers.map(({ blur, mask }) => (
          <div key={blur} className={`absolute inset-0 ${blur} ${mask}`} />
        ))}
        <div className="absolute inset-0 bg-white/3 mask-[linear-gradient(to_bottom,black_0%,transparent_100%)]" />
      </div>
      <Nav authError={authError} onDismissAuthError={() => setAuthError(null)} />
    </>
  );
}
