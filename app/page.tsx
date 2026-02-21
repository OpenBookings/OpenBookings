"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase/firebase";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import FocusOverlay from "@/components/FocusOverlay";
import { Calendar05 } from "@/components/DatePicker";
import { getRandomBackgroundImage } from "@/lib/background";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

import {
  CalendarIcon,
  PersonIcon,
  MagnifyingGlassIcon,
} from "@/components/Icons";
import { SearchBar } from "@/components/SearchBar";
import { CS_AuthForm } from "@/components/auth/CS-AuthForm";

// Component to handle Firebase auth callback redirects
function AuthRedirectHandler({ onRedirecting }: { onRedirecting: (redirecting: boolean) => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Check authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthChecked(true);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Wait for auth state to be checked before processing redirects
    if (!authChecked) {
      return;
    }

    const oobCode = searchParams.get("oobCode");
    const callback = searchParams.get("callback");
    const mode = searchParams.get("mode");
    
    // Check if this is a Firebase authentication callback
    if (oobCode || (callback && mode)) {
      // If user is already authenticated, clear the query params and stay on home
      if (user) {
        // User is authenticated, clear query params to prevent redirect loop
        router.replace("/");
        onRedirecting(false);
        return;
      }
      
      // User not authenticated, redirect to verify page
      onRedirecting(true);
      // Preserve all query parameters when redirecting
      const params = new URLSearchParams(searchParams.toString());
      router.replace(`/auth/verify?${params.toString()}`);
      return;
    }
    onRedirecting(false);
  }, [searchParams, router, onRedirecting, user, authChecked]);

  return null;
}

export default function Home() {
  const router = useRouter();
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [people, setPeople] = useState(2);
  const [destination, setDestination] = useState("");

  const [openSearchBar, setOpenSearchBar] = useState(false);
  const [openDatePicker, setOpenDatePicker] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<{ url: string; name: string; gradientA: string; gradientB: string } | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // Track authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribe();
  }, []);

  // Stable callback for redirect handler
  const handleRedirecting = useCallback((redirecting: boolean) => {
    setIsRedirecting(redirecting);
  }, []);

  // Set random background only on client side to avoid hydration mismatch
  useEffect(() => {
    setBackgroundImage(getRandomBackgroundImage());
  }, []);

  // Show loading state while redirecting
  if (isRedirecting) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-4"></div>
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
        <AuthRedirectHandler onRedirecting={handleRedirecting} />
      </Suspense>
    <main className="min-h-screen text-white relative">
            {/* Background Image */}
            <div
        className="fixed inset-0 bg-black bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage:
            backgroundImage ? `url('${backgroundImage.url}')` : undefined,
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
        style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }}
      >
        <img 
          src="/Openbookings-logo-v2.svg" 
          alt="OpenBookings Logo" 
          className="h-8 sm:h-10 md:h-16 w-auto select-none pointer-events-none"
          draggable="false"
          style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }}
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
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none'
              }}
              onClick={() => {
                signOut(auth);
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
      <div className="fixed bottom-0 left-0 flex items-end justify-start px-8 sm:pb-8 md:px-12 lg:px-16 z-10">
        <div className="max-w-4xl text-left flex items-center">
          <div className="flex flex-col items-center justify-center mr-7">
            <div
              className="bg-gray-300 w-1 rounded-full mb-2"
              style={{ height: "calc(7.5rem)" }}
            ></div>
          </div>
          <div className="flex flex-col justify-center">
            <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight mb-3 select-none text-gray-300">
              Discover{" "}
              <span 
                className="bg-clip-text text-transparent select-none text-glow text-stroke-hero"
                style={{
                  backgroundImage: backgroundImage 
                    ? `linear-gradient(to top right, ${backgroundImage.gradientA}, ${backgroundImage.gradientB})`
                    : undefined
                }}
              >
                {backgroundImage?.name || ""}
              </span>
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
            {/* Destination - Centered with navigation arrows */}
            <InputGroup className="bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 transition-all group">
              <InputGroupInput
                placeholder="Destination..."
                value={destination ?? ""}
                readOnly
                onClick={() => setOpenSearchBar(true)}
                className="cursor-pointer"
              />
              <InputGroupAddon>
                <MagnifyingGlassIcon />
              </InputGroupAddon>
            </InputGroup>

            <FocusOverlay
              open={openSearchBar}
              onClose={() => setOpenSearchBar(false)}
            >
              <div>
                <SearchBar value={destination} onChange={(value) => setDestination(value)} onSearch={() => setOpenSearchBar(false)} placeholder="Where are you going?" />
              </div>
            </FocusOverlay>

            {/* Date Picker - From and Till as one field */}
            <div
              className="bg-white/5 backdrop-blur-sm rounded-lg sm:rounded-xl border border-white/10 p-2.5 sm:p-3 cursor-pointer hover:bg-white/10 transition-all group flex items-center gap-2 sm:gap-3"
              onClick={() => setOpenDatePicker(true)}
            >
              <CalendarIcon />
              <div className="flex-1 flex items-center gap-1.5 sm:gap-2">
                {/* From Date */}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] sm:text-xs text-slate-400 font-medium mb-0.5">
                    From
                  </div>
                  <div className="text-xs sm:text-sm text-white font-medium truncate">
                    {checkIn ? (
                      <span className="text-white">
                        {new Date(checkIn).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    ) : (
                      <span className="text-slate-400">Select date</span>
                    )}
                  </div>
                </div>

                {/* Separator */}
                <div className="shrink-0 px-1 sm:px-2">
                  <div className="w-px h-6 sm:h-8 bg-white/20"></div>
                </div>

                {/* Till Date */}
                <div className="flex-1 min-w-0 text-right">
                  <div className="text-[10px] sm:text-xs text-slate-400 font-medium mb-0.5">
                    Till
                  </div>
                  <div className="text-xs sm:text-sm text-white font-medium truncate">
                    {checkOut ? (
                      <span className="text-white">
                        {new Date(checkOut).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    ) : (
                      <span className="text-slate-400">Select date</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

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
                      const year = date.getFullYear()
                      const month = String(date.getMonth() + 1).padStart(2, '0')
                      const day = String(date.getDate()).padStart(2, '0')
                      return `${year}-${month}-${day}`
                    }

                    if (range?.from) {
                      setCheckIn(formatDate(range.from))
                    } else {
                      setCheckIn("")
                    }
                    
                    if (range?.to) {
                      setCheckOut(formatDate(range.to))
                    } else {
                      setCheckOut("")
                    }
                  }}
                />
              </div>
            </FocusOverlay>

            {/* Guests Selector */}
            <div className="bg-white/5 backdrop-blur-sm rounded-lg sm:rounded-xl border border-white/10 p-2.5 sm:p-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <PersonIcon />
                <div className="flex-1">
                  <div className="text-[10px] sm:text-xs text-slate-300 font-medium mb-0.5 sm:mb-1">
                    Guests
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <button
                      onClick={() => setPeople(Math.max(1, people - 1))}
                      className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all hover:scale-110 text-sm sm:text-base"
                    >
                      -
                    </button>
                    <span className="text-xs sm:text-sm text-white font-medium min-w-12 sm:min-w-16 text-center">
                      {people} {people !== 1 ? "Guests" : "Guest"}
                    </span>
                    <button
                      onClick={() => setPeople(people + 1)}
                      className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all hover:scale-110 text-sm sm:text-base"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* CTA Button */}
            <button className="w-full px-4 py-3 sm:px-6 sm:py-4 bg-white/95 text-gray-900 rounded-lg sm:rounded-xl font-semibold hover:bg-white transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] text-sm sm:text-base">
              Find my trip
            </button>
          </div>
        </div>
      </div>
    </main>
    </>
  );
}
