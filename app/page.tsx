"use client";

import { useState } from "react";
import FocusOverlay from "@/components/FocusOverlay";
import { Calendar05 } from "@/components/DatePicker";

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

export default function Home() {
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [people, setPeople] = useState(2);
  const [destination, setDestination] = useState("");

  const [openSearchBar, setOpenSearchBar] = useState(false);
  const [openDatePicker, setOpenDatePicker] = useState(false);

  return (
    <main className="min-h-screen text-white relative">
      {/* Background Image */}
      <div
        className="fixed inset-0 bg-black bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage:
            "url('https://storage.googleapis.com/openbookings-backgrounds/Hawaii-Honolulu.avif')",
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
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight mb-3 select-none">
              Discover{" "}
              <span className="bg-clip-text text-transparent bg-linear-to-r from-indigo-400 via-purple-400 to-pink-400 select-none">
                Rome
              </span>
            </h1>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight mb-4 ml-0.5 text-gray-300 select-none">
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
            <InputGroup className="bg-black/50 backdrop-blur-sm border border-white/10 hover:bg-white/10 transition-all group">
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
                <InputGroup className=" backdrop-blur-sm rounded-lg sm:rounded-xl border border-white/10">
                  <InputGroupInput
                    placeholder="Where are you going?"
                    value={destination ?? ""}
                    onChange={(e) => setDestination(e.target.value)}
                    className="text-white"
                  />
                  <InputGroupAddon>
                    <MagnifyingGlassIcon />
                  </InputGroupAddon>
                </InputGroup>
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
              <div>
                <Calendar05 />
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
