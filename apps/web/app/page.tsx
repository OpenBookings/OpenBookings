"use client";

import { useState, useEffect, startTransition, use } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { getRandomBackgroundImage } from "@/lib/background";

import { SearchBarOverlay } from "@/components/search/SearchBar";
import { Nav } from "@/components/nav";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  ATTEMPTS_EXCEEDED: "Too many sign-in attempts. Please request a new magic link.",
  INVALID_TOKEN: "This sign-in link has expired or already been used.",
  TOKEN_NOT_FOUND: "Invalid sign-in link. Please request a new one.",
  EXPIRED_TOKEN: "This sign-in link has expired. Please request a new one.",
  USER_NOT_FOUND: "No account found. Please sign up first.",
  USER_BANNED: "Your account has been suspended. Please contact support.",
  SOCIAL_ACCOUNT_ALREADY_LINKED: "This account is already linked to another user.",
};

export default function Home() {
  const router = useRouter();
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [rooms, setRooms] = useState(1);
  const [destination, setDestination] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const [openSearchBar, setOpenSearchBar] = useState(false);
  const [openDatePicker, setOpenDatePicker] = useState(false);
  const [openGuestSelector, setOpenGuestSelector] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);

  function performSearch() {
    const params = new URLSearchParams();
    if (destination) params.set("destination", destination);
    if (checkIn) params.set("arrival", checkIn);
    if (checkOut) params.set("departure", checkOut);
    if (adults) params.set("adults", adults.toString());
    if (children) params.set("children", children.toString());
    if (rooms) params.set("rooms", rooms.toString());

    const searchUrl = `/search?${params.toString()}`;
    router.push(searchUrl);
  }

  // Read auth error from URL on mount, then clean the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      const msg = AUTH_ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again.";
      startTransition(() => setAuthError(msg));
      posthog.capture("auth_error", { error_code: error });
      router.replace("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Set random background only on client side to avoid hydration mismatch
  // Persist selection in localStorage; cache image bytes in Cache API
  useEffect(() => {
    const CACHE_NAME = "ob_backgrounds";

    async function loadBackground() {
      let bg: { url: string; name: string };

      const stored = localStorage.getItem(CACHE_NAME);
      if (stored) {
        try {
          bg = JSON.parse(stored);
        } catch {
          bg = getRandomBackgroundImage();
          localStorage.setItem(CACHE_NAME, JSON.stringify(bg));
        }
      } else {
        bg = getRandomBackgroundImage();
        localStorage.setItem(CACHE_NAME, JSON.stringify(bg));
      }

      setBackgroundImage(bg);

      try {
        const cache = await caches.open(CACHE_NAME);
        let response = await cache.match(bg.url);
        if (!response) {
          await cache.add(bg.url);
          response = await cache.match(bg.url);
        }
        if (response) {
          const blob = await response.blob();
          setBackgroundSrc(URL.createObjectURL(blob));
          return;
        }
      } catch {
        // Cache API unavailable (e.g. private browsing on some browsers)
      }

      // Fallback to direct URL
      setBackgroundSrc(bg.url);
    }

    loadBackground();
  }, []);

  return (
    <>
      <main className="min-h-screen text-white relative">
        {/* Background Image */}
        <div
          className="fixed inset-0 bg-black bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: backgroundSrc
              ? `url('${backgroundSrc}')`
              : undefined,
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0) 100%)",
            }}
          ></div>
        </div>

        <Nav authError={authError} onDismissAuthError={() => setAuthError(null)} />

        {/* Main content - CTA slightly below center */}
        <div className="fixed inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center translate-y-[12vh]" style={{ textShadow: "0 2px 24px rgba(0,0,0,0.85), 0 1px 6px rgba(0,0,0,0.6)" }}>
            <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight mb-3 select-none">
              Discover {backgroundImage?.name || ""}
            </h1>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight ml-0.5 text-gray-300 select-none">
              Quick, Easy & Open-Source
            </h1>
          </div>
        </div>

        <div className="fixed bottom-16 sm:bottom-20 left-1/2 -translate-x-1/2 w-[calc(100vw-2rem)] max-w-4xl z-50">
          <SearchBarOverlay
            destination={destination}
            setDestination={setDestination}
            checkIn={checkIn}
            setCheckIn={setCheckIn}
            checkOut={checkOut}
            setCheckOut={setCheckOut}
            adults={adults}
            setAdults={setAdults}
            childCount={children}
            setChildCount={setChildren}
            rooms={rooms}
            setRooms={setRooms}
            openSearchBar={openSearchBar}
            setOpenSearchBar={setOpenSearchBar}
            openDatePicker={openDatePicker}
            setOpenDatePicker={setOpenDatePicker}
            openGuestSelector={openGuestSelector}
            setOpenGuestSelector={setOpenGuestSelector}
            onSearch={performSearch}
          />
        </div>
  
      </main>
    </>
  );
}
