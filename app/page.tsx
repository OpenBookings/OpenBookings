"use client";

import { useState, useEffect } from "react";
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

export default function Home() {
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [people, setPeople] = useState(2);
  const [destination, setDestination] = useState("");

  const [openSearchBar, setOpenSearchBar] = useState(false);
  const [openDatePicker, setOpenDatePicker] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<{ url: string; name: string; gradientA: string; gradientB: string } | null>(null);

  // Set random background only on client side to avoid hydration mismatch
  useEffect(() => {
    setBackgroundImage(getRandomBackgroundImage());
  }, []);

  return (
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
          src="/Openbookings-logo.svg" 
          alt="OpenBookings Logo" 
          className="h-8 sm:h-10 md:h-16 w-auto select-none pointer-events-none"
          draggable="false"
          style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }}
        />
        {/* <p className="text-xl text-gray-300 pb-0.5 pt-0.5">OpenBookings</p> */}
      </div>

      {/* Profile in top right corner */}
      <div className="fixed top-0 right-0 p-4 sm:p-6 md:p-8 z-20 flex flex-row items-center gap-2 sm:gap-3">
        <button className="text-sm sm:text-base md:text-lg text-white font-medium transition-colors px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-black/50 backdrop-blur-md border border-white/10">
          Sign in
        </button>
        <img 
          src="/profile_avatar.png" 
          alt="Profile" 
          className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 rounded-full object-cover cursor-pointer hover:ring-2 hover:ring-white/50 transition-all border-2 border-white/20"
        />
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
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight mb-3 select-none text-gray-300">
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
  );
}
