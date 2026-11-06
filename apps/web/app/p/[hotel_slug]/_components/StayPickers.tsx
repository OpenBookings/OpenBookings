"use client";

import { useCallback, useState } from "react";
import FocusOverlay from "@/components/plug-in/FocusOverlay";
import { Calendar05 } from "@/components/plug-in/DatePicker";
import { GuestSelector } from "@/components/plug-in/GuestSelector";
import type { Guests } from "@/components/plug-in/guest-limits";
import type { Stay, StayDraft } from "../_lib/stay";

export type StayPanel = "dates" | "guests" | null;

/** YYYY-MM-DD for a date picked in the calendar, which works in local time. */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The search bar's date and guest overlays, opened from the room panel. The
 * pick is a draft until the overlay closes; then a changed, complete pick is
 * handed to `onChange`, which writes it to the URL.
 */
export function StayPickers({ stay, party, openPanel, onClose, onChange }: {
  stay: Stay | null;
  /** The party in the URL, also when it has no dates. */
  party: Guests;
  openPanel: StayPanel;
  onClose: () => void;
  onChange: (next: StayDraft) => void;
}) {
  const [checkIn, setCheckIn] = useState(stay?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(stay?.checkOut ?? "");
  const [guests, setGuests] = useState<Guests>(party);

  // Each opening starts from what the URL says now.
  const [opened, setOpened] = useState<StayPanel>(null);
  if (opened !== openPanel) {
    setOpened(openPanel);
    if (openPanel) {
      setCheckIn(stay?.checkIn ?? "");
      setCheckOut(stay?.checkOut ?? "");
      setGuests(party);
    }
  }

  const closeDates = useCallback(() => {
    const complete = checkIn !== "" && checkOut !== "" && checkOut > checkIn;
    if (complete && (checkIn !== stay?.checkIn || checkOut !== stay?.checkOut)) {
      onChange({ checkIn, checkOut, ...party });
    }
    onClose();
  }, [checkIn, checkOut, stay, party, onChange, onClose]);

  const closeGuests = useCallback(() => {
    if (guests.adults !== party.adults || guests.children !== party.children || guests.rooms !== party.rooms) {
      onChange({ checkIn: stay?.checkIn ?? null, checkOut: stay?.checkOut ?? null, ...guests });
    }
    onClose();
  }, [guests, party, stay, onChange, onClose]);

  // GuestSelector reports on every render of its own; only a change is kept.
  const pickGuests = useCallback((adults: number, children: number, rooms: number) => {
    setGuests((prev) =>
      prev.adults === adults && prev.children === children && prev.rooms === rooms ? prev : { adults, children, rooms },
    );
  }, []);

  return (
    <>
      <FocusOverlay open={openPanel === "dates"} onClose={closeDates}>
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

      <FocusOverlay open={openPanel === "guests"} onClose={closeGuests}>
        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <GuestSelector
            value={`${guests.adults} adults, ${guests.children} children, ${guests.rooms} rooms`}
            onChange={pickGuests}
          />
        </div>
      </FocusOverlay>
    </>
  );
}
