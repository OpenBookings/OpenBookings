import posthog from "posthog-js";
import FocusOverlay from "@/components/plug-in/FocusOverlay";
import { Calendar05 } from "@/components/plug-in/DatePicker";
import { SearchBar } from "@/components/plug-in/SearchBar";
import { GuestSelector } from "@/components/plug-in/GuestSelector";
import {
  CalendarIcon,
  PersonIcon,
  MagnifyingGlassIcon,
} from "@/components/Icons";

interface SearchBarOverlayProps {
  destination: string;
  setDestination: (value: string) => void;
  checkIn: string;
  setCheckIn: (value: string) => void;
  checkOut: string;
  setCheckOut: (value: string) => void;
  adults: number;
  setAdults: (value: number) => void;
  childCount: number;
  setChildCount: (value: number) => void;
  rooms: number;
  setRooms: (value: number) => void;
  openSearchBar: boolean;
  setOpenSearchBar: (open: boolean) => void;
  openDatePicker: boolean;
  setOpenDatePicker: (open: boolean) => void;
  openGuestSelector: boolean;
  setOpenGuestSelector: (open: boolean) => void;
  onSearch: () => void;
  isDirty?: boolean;
}

export function SearchBarOverlay({
  destination,
  setDestination,
  checkIn,
  setCheckIn,
  checkOut,
  setCheckOut,
  adults,
  setAdults,
  childCount,
  setChildCount,
  rooms,
  setRooms,
  openSearchBar,
  setOpenSearchBar,
  openDatePicker,
  setOpenDatePicker,
  openGuestSelector,
  setOpenGuestSelector,
  onSearch,
  isDirty = true,
}: SearchBarOverlayProps) {
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  return (
    <>
      {/* Search bar at bottom center - horizontal layout */}
      
        <div className="bg-black/30 backdrop-blur-2xl rounded-2xl border border-white/20 shadow-2xl p-2">
          <div className="flex items-stretch gap-0">

            {/* Destination */}
            <div
              className="flex items-center gap-2 px-4 py-3 cursor-pointer flex-2 min-w-0 rounded-xl hover:bg-white/10 transition-colors"
              onClick={() => {
                posthog.capture("destination_search_opened");
                setOpenSearchBar(true);
              }}
            >
              <MagnifyingGlassIcon />
              <span className={`text-sm font-medium truncate ${destination ? "text-white" : "text-white/40"}`}>
                {destination || "Where are you going?"}
              </span>
            </div>

            <div className="w-px bg-white/15 my-2 mx-2 shrink-0" />

            {/* Date Picker */}
            <div
              className="flex items-center gap-2 px-4 py-3 cursor-pointer flex-2 min-w-0 rounded-xl hover:bg-white/10 transition-colors"
              onClick={() => {
                posthog.capture("date_picker_opened");
                setOpenDatePicker(true);
              }}
            >
              <CalendarIcon />
              <span className={`text-sm font-medium truncate ${checkIn || checkOut ? "text-white" : "text-white/40"}`}>
                {checkIn
                  ? new Date(checkIn).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "Check-in"}
                {" — "}
                {checkOut
                  ? new Date(checkOut).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "Check-out"}
              </span>
            </div>

            <div className="w-px bg-white/15 my-2 mx-2 shrink-0" />

            {/* Guests Selector */}
            <div
              className="flex items-center gap-2 px-4 py-3 cursor-pointer flex-2 min-w-0 rounded-xl hover:bg-white/10 transition-colors"
              onClick={() => {
                posthog.capture("guest_selector_opened");
                setOpenGuestSelector(true);
              }}
            >
              <PersonIcon />
              <span className="text-sm text-white font-medium truncate">
                {adults} {adults === 1 ? "adult" : "adults"} · {childCount} {childCount === 1 ? "child" : "children"} · {rooms} {rooms === 1 ? "room" : "rooms"}
              </span>
            </div>

            {/* Search Button */}
            <button
              disabled={!isDirty}
              className={`ml-2 px-6 py-3 rounded-xl font-semibold transition-all text-sm shrink-0 ${
                isDirty
                  ? "bg-white/95 text-gray-900 hover:bg-white shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  : "bg-white/20 text-white/40 cursor-not-allowed"
              }`}
              onClick={() => {
                if (!isDirty) return;
                posthog.capture("search_initiated", {
                  destination,
                  check_in: checkIn,
                  check_out: checkOut,
                  adults,
                  children: childCount,
                  rooms,
                });
                onSearch();
              }}
            >
              Search
            </button>
          </div>
        </div>

      {/* Overlays */}
      <FocusOverlay open={openSearchBar} onClose={() => setOpenSearchBar(false)}>
        <div>
          <SearchBar
            value={destination}
            onChange={(value: string) => setDestination(value)}
            onSearch={() => setOpenSearchBar(false)}
            placeholder="Where are you going?"
          />
        </div>
      </FocusOverlay>

      <FocusOverlay open={openDatePicker} onClose={() => setOpenDatePicker(false)}>
        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <Calendar05
            checkIn={checkIn}
            checkOut={checkOut}
            onDateChange={(range) => {
              setCheckIn(range?.from ? formatDate(range.from) : "");
              setCheckOut(range?.to ? formatDate(range.to) : "");
            }}
          />
        </div>
      </FocusOverlay>

      <FocusOverlay open={openGuestSelector} onClose={() => setOpenGuestSelector(false)}>
        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <GuestSelector
            value={`${adults} adults, ${childCount} children, ${rooms} rooms`}
            onChange={(nextAdults: number, nextChildren: number, nextRooms: number) => {
              setAdults(nextAdults);
              setChildCount(nextChildren);
              setRooms(nextRooms);
            }}
          />
        </div>
      </FocusOverlay>
    </>
  );
}
