"use client";

import * as React from "react"
import { Card, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PlusIcon, MinusIcon } from "lucide-react"
import { clampGuests } from "./guest-limits"

interface GuestSelectorProps {
  /**
   * Initial value, e.g. "2 adults, 0 children".
   * First number = adults, second number = children.
   */
  value?: string
  /** Fallback when value is missing or unparsable */
  defaultAdults?: number
  defaultChildren?: number
  defaultRooms?: number
  /** Called whenever adults/children/rooms change */
  onChange?: (adults: number, children: number, rooms: number) => void
}

function parseGuestValue(
  value: string | undefined,
  defaultAdults: number,
  defaultChildren: number,
  defaultRooms: number
) {
  if (!value) {
    return clampGuests({ adults: defaultAdults, children: defaultChildren, rooms: defaultRooms })
  }

  const matches = value.match(/\d+/g)
  if (!matches || matches.length === 0) {
    return clampGuests({ adults: defaultAdults, children: defaultChildren, rooms: defaultRooms })
  }

  const adults = Number.parseInt(matches[0] ?? "", 10)
  const children = matches[1] != null ? Number.parseInt(matches[1], 10) : defaultChildren
  const rooms = matches[2] != null ? Number.parseInt(matches[2], 10) : defaultRooms

  return clampGuests({
    adults: Number.isFinite(adults) ? adults : defaultAdults,
    children: Number.isFinite(children) ? children : defaultChildren,
    rooms: Number.isFinite(rooms) ? rooms : defaultRooms,
  })
}

export function GuestSelector({
  value,
  defaultAdults = 2,
  defaultChildren = 0,
  defaultRooms = 1,
  onChange,
}: GuestSelectorProps) {
  const [{ adults, children, rooms }, setGuests] = React.useState(() =>
    parseGuestValue(value, defaultAdults, defaultChildren, defaultRooms)
  )

  React.useEffect(() => {
    if (!onChange) return
    onChange(adults, children, rooms)
  }, [adults, children, rooms, onChange])

  // Every change goes through clampGuests, so the party is always one search accepts.
  const updateAdults = (delta: number) =>
    setGuests((prev) => clampGuests({ ...prev, adults: prev.adults + delta }))

  const updateChildren = (delta: number) =>
    setGuests((prev) => clampGuests({ ...prev, children: prev.children + delta }))

  const updateRooms = (delta: number) =>
    setGuests((prev) => clampGuests({ ...prev, rooms: prev.rooms + delta }))

  return (
    <div className="w-full min-w-0 max-w-lg mx-auto space-y-3 text-white">
      <CardTitle className="pl-4 text-xl font-semibold tracking-[0.16em] text-white/60 uppercase">
        Guests
      </CardTitle>
      <Card className="border border-white/20 bg-black/70 shadow-2xl backdrop-blur-md">
        <CardContent className="px-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-md font-medium text-white">Adults</div>
            <div className="text-xs text-white/60">Ages 13 or above</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10"
              onClick={() => updateAdults(-1)}
            >
              <MinusIcon className="h-4 w-4" />
            </Button>
            <span className="w-6 text-center text-sm font-semibold">{adults}</span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10"
              onClick={() => updateAdults(1)}
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-md font-medium text-white">Children</div>
            <div className="text-xs text-white/60">Ages 0–12</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10"
              onClick={() => updateChildren(-1)}
            >
              <MinusIcon className="h-4 w-4" />
            </Button>
            <span className="w-6 text-center text-sm font-semibold">{children}</span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10"
              onClick={() => updateChildren(1)}
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="h-px w-full bg-white/10" />

        <div className="flex items-center justify-between">
          <div>
            <div className="text-md font-medium text-white">Rooms</div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="outline" className="border-white/30 text-white hover:bg-white/10" onClick={() => updateRooms(-1)}>
              <MinusIcon className="h-4 w-4" />
            </Button>
            <span className="w-6 text-center text-sm font-semibold">{rooms}</span>
            <Button type="button" size="icon" variant="outline" className="border-white/30 text-white hover:bg-white/10" onClick={() => updateRooms(1)}>
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
        </CardContent>
      </Card>
    </div>
  )
}