"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth-client";
import FocusOverlay from "@/components/plug-in/FocusOverlay";
import { Calendar05 } from "@/components/plug-in/DatePicker";
import { getRandomBackgroundImage } from "@/lib/background";

import {
  CalendarIcon,
  PersonIcon,
  MagnifyingGlassIcon,
} from "@/components/Icons";
import { SearchBar } from "@/components/plug-in/SearchBar";
import { CS_AuthForm } from "@/components/auth/CS-AuthForm";
import { GuestSelector } from "@/components/plug-in/GuestSelector";

export default function Home() {
  const router = useRouter();
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [rooms, setRooms] = useState(1);
  const [destination, setDestination] = useState("");

  const [openSearchBar, setOpenSearchBar] = useState(false);
  const [openDatePicker, setOpenDatePicker] = useState(false);
  const [openGuestSelector, setOpenGuestSelector] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);

  const { data: session } = authClient.useSession();
  const user = session?.user ?? null;

  // Identify user in PostHog when session is available
  useEffect(() => {
    if (user) {
      posthog.identify(user.id, { email: user.email });
    }
  }, [user?.id]);

  // Set random background only on client side to avoid hydration mismatch
  // Persist selection in localStorage; cache image bytes in Cache API
  useEffect(() => {
    const CACHE_NAME = "openbookings-backgrounds";

    async function loadBackground() {
      let bg: { url: string; name: string };

      const stored = localStorage.getItem("openbookings_background");
      if (stored) {
        try {
          bg = JSON.parse(stored);
        } catch {
          bg = getRandomBackgroundImage();
          localStorage.setItem("openbookings_background", JSON.stringify(bg));
        }
      } else {
        bg = getRandomBackgroundImage();
        localStorage.setItem("openbookings_background", JSON.stringify(bg));
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

        {/* Logo in top left corner */}
        <div
          className="fixed top-0 left-0 p-4 sm:p-6 md:p-8 z-20 flex flex-row items-center gap-2 select-none"
          style={{
            userSelect: "none",
            WebkitUserSelect: "none",
            MozUserSelect: "none",
            msUserSelect: "none",
          }}
        >
          <img
            src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
            alt="OpenBookings Logo"
            className="h-8 sm:h-10 md:h-16 w-auto select-none pointer-events-none"
            draggable="false"
            style={{
              userSelect: "none",
              WebkitUserSelect: "none",
              MozUserSelect: "none",
              msUserSelect: "none",
            }}
          />
        </div>

        {/* Profile in top right corner */}
        <div className="fixed top-0 right-0 p-4 sm:p-6 md:p-8 z-20 flex flex-row items-center gap-2 sm:gap-3">
          {user ? (
            // Show user profile image if authenticated. On hover, show user's email in a tooltip.
            <div className="relative group flex items-center">
              <img
                src="/profile_avatar.png"
                alt="User Profile"
                className="h-12 w-12 rounded-full object-cover border border-white/20 shadow"
                draggable="false"
                style={{
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  MozUserSelect: "none",
                  msUserSelect: "none",
                }}
                onClick={async () => {
                  posthog.capture("sign_out");
                  posthog.reset();
                  await authClient.signOut();
                  router.replace("/");
                }}
                aria-describedby="profile-email-tooltip"
              />
              {/* Tooltip on hover */}
              <div
                id="profile-email-tooltip"
                className="absolute right-1/2 top-full mt-2 z-30 min-w-max px-3 py-2 rounded-lg bg-black/90 text-white text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150"
                role="tooltip"
              >
                {user.email}
              </div>
            </div>
          ) : (
            <CS_AuthForm />
          )}
        </div>

        {/* Main content - CTA */}
        <div className="fixed bottom-0 left-0 flex items-end justify-start px-8 sm:pb-8 md:px-12 lg:px-16 z-10 hero-cta">
          <div className="max-w-4xl text-left flex items-center">
            <div className="flex flex-col items-center justify-center mr-7">
              <div
                className="bg-gray-300 w-1 rounded-full mb-2"
                style={{ height: "calc(7.5rem)" }}
              ></div>
            </div>
            <div className="flex flex-col justify-center">
              <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight mb-3 select-none text-gray-300">
                Discover {backgroundImage?.name || ""}
              </h1>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight mb-4 ml-0.5 text-gray-400 select-none">
                Quick, Easy & Open-Source
              </h1>
            </div>
          </div>
        </div>

        {/* Search box at right bottom - Glassmorphism design */}
        <div className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 left-4 sm:left-auto w-auto sm:w-96 max-w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-4rem)] z-50">
          <div className="bg-black/30 backdrop-blur-2xl rounded-2xl sm:rounded-3xl border border-white/20 shadow-2xl p-4 sm:p-6">
            <div className="flex flex-col sm:gap-5">
              <h2 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-white/90">
                The world is waiting...
              </h2>
              {/* Destination */}
              <div
                className="search-box-field flex items-center gap-2 sm:gap-3 cursor-pointer"
                onClick={() => { posthog.capture("destination_search_opened"); setOpenSearchBar(true); }}
              >
                <MagnifyingGlassIcon />
                <span
                  className={`flex-1 text-sm sm:text-base font-medium truncate ${destination ? "text-white" : "text-white/40"}`}
                >
                  {destination || "Destination..."}
                </span>
              </div>

              <FocusOverlay
                open={openSearchBar}
                onClose={() => setOpenSearchBar(false)}
              >
                <div>
                  <SearchBar
                    value={destination}
                    onChange={(value) => setDestination(value)}
                    onSearch={() => setOpenSearchBar(false)}
                    placeholder="Where are you going?"
                  />
                </div>
              </FocusOverlay>

              {/* Date Picker - From and Till as one field */}
              <div
                className="search-box-field cursor-pointer flex items-center gap-2 sm:gap-3"
                onClick={() => { posthog.capture("date_picker_opened"); setOpenDatePicker(true); }}
              >
                <CalendarIcon />
                <div className="flex-1 flex items-center gap-2 sm:gap-3">
                  {/* From Date */}
                  <div className="flex-1 min-w-0">
                    <span
                      className={`text-sm sm:text-base font-medium truncate block ${checkIn ? "text-white" : "text-white/40"}`}
                    >
                      {checkIn
                        ? new Date(checkIn).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "From"}
                    </span>
                  </div>

                  {/* Separator */}
                  <div className="shrink-0">
                    <div className="w-px h-5 bg-white/20"></div>
                  </div>

                  {/* Till Date */}
                  <div className="flex-1 min-w-0 text-right">
                    <span
                      className={`text-sm sm:text-base font-medium truncate block ${checkOut ? "text-white" : "text-white/40"}`}
                    >
                      {checkOut
                        ? new Date(checkOut).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "Till"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Date Picker Overlay */}
              <FocusOverlay
                open={openDatePicker}
                onClose={() => setOpenDatePicker(false)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <Calendar05
                    checkIn={checkIn}
                    checkOut={checkOut}
                    onDateChange={(range) => {
                      // Format date as YYYY-MM-DD in local timezone
                      const formatDate = (date: Date): string => {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, "0");
                        const day = String(date.getDate()).padStart(2, "0");
                        return `${year}-${month}-${day}`;
                      };

                      if (range?.from) {
                        setCheckIn(formatDate(range.from));
                      } else {
                        setCheckIn("");
                      }

                      if (range?.to) {
                        setCheckOut(formatDate(range.to));
                      } else {
                        setCheckOut("");
                      }
                    }}
                  />
                </div>
              </FocusOverlay>

              {/* Guests Selector */}
              <div
                className="search-box-field flex items-center gap-2 sm:gap-3 cursor-pointer"
                onClick={() => { posthog.capture("guest_selector_opened"); setOpenGuestSelector(true); }}
              >
                <PersonIcon />
                <div className="flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-sm sm:text-base text-white font-medium">
                      {adults} {adults === 1 ? "Adult" : "Adults"}
                    </span>

                    {children > 0 && (
                      <span className="text-sm sm:text-base text-white/70">
                        • {children} {children === 1 ? "Child" : "Children"}
                      </span>
                    )}
                    <span className="text-sm sm:text-base text-white/70">
                      • {rooms} {rooms === 1 ? "Room" : "Rooms"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Guests Selector Overlay */}
              <FocusOverlay
                open={openGuestSelector}
                onClose={() => setOpenGuestSelector(false)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <GuestSelector
                    value={`${adults} adults, ${children} children, ${rooms} rooms`}
                    onChange={(nextAdults, nextChildren, nextRooms) => {
                      setAdults(nextAdults);
                      setChildren(nextChildren);
                      setRooms(nextRooms);
                    }}
                  />
                </div>
              </FocusOverlay>

              {/* CTA Button */}
              <button
                className="w-full px-4 py-3 sm:px-6 sm:py-4 bg-white/95 text-gray-900 rounded-lg sm:rounded-xl font-semibold hover:bg-white transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] text-sm sm:text-base"
                onClick={() => {
                  posthog.capture("search_initiated", {
                    destination,
                    check_in: checkIn,
                    check_out: checkOut,
                    adults,
                    children,
                    rooms,
                  });
                }}
              >
                Find my trip
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
