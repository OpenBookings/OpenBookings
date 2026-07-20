"use client";

import { useEffect, useState } from "react";
import { AuthLoadingScreen } from "./AuthLoadingScreen";

/**
 * Full-page brand loader shown only on full document loads — the moment
 * between login and landing in the app, or opening it fresh. It is part of
 * the server-rendered HTML, so it covers the page until hydration, then
 * fades out. Client-side navigations keep the layout mounted and never show
 * it again.
 */
export function SessionEntryOverlay() {
  const [visible, setVisible] = useState(true);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    // Brief branded beat, then fade (AuthLoadingScreen fades over 0.5s).
    const fade = setTimeout(() => setVisible(false), 300);
    const unmount = setTimeout(() => setGone(true), 900);
    return () => {
      clearTimeout(fade);
      clearTimeout(unmount);
    };
  }, []);

  if (gone) return null;
  return <AuthLoadingScreen visible={visible} />;
}
