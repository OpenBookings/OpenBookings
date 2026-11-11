"use client";

import * as React from "react"
import { Card, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PlusIcon, MinusIcon } from "lucide-react"
import { AGE_BANDS, clampGuests, type Guests } from "./guest-limits"

interface GuestSelectorProps {
  /** The party to start from; missing counts are 2 adults, no children or infants, 1 room. */
  initial?: Partial<Guests>
  /** False on an adults-only property: the children and infants rows are hidden and kept at 0. */
  childrenWelcome?: boolean
  /** Called whenever the party changes */
  onChange?: (guests: Guests) => void
}

const DEFAULT: Guests = { adults: 2, children: 0, infants: 0, rooms: 1 }

export function GuestSelector({ initial, childrenWelcome = true, onChange }: GuestSelectorProps) {
  const [guests, setGuests] = React.useState<Guests>(() =>
    clampGuests({ ...DEFAULT, ...initial }, { childrenWelcome }),
  )

  React.useEffect(() => {
    onChange?.(guests)
  }, [guests, onChange])

  // Every change goes through clampGuests, so the party is always one search accepts.
  const update = (key: keyof Guests, delta: number) =>
    setGuests((prev) => clampGuests({ ...prev, [key]: prev[key] + delta }, { childrenWelcome }))

  return (
    <div className="w-full min-w-0 max-w-lg mx-auto space-y-3 text-white">
      <CardTitle className="pl-4 text-xl font-semibold tracking-[0.16em] text-white/60 uppercase">
        Guests
      </CardTitle>
      <Card className="border border-white/20 bg-black/70 shadow-2xl backdrop-blur-md">
        <CardContent className="px-4 space-y-3">
          <CounterRow label="Adults" hint={AGE_BANDS.adults} value={guests.adults} onStep={(d) => update("adults", d)} />
          {childrenWelcome && (
            <>
              <CounterRow
                label="Children"
                hint={AGE_BANDS.children}
                value={guests.children}
                onStep={(d) => update("children", d)}
              />
              <CounterRow
                label="Infants"
                hint={`${AGE_BANDS.infants} · free`}
                value={guests.infants}
                onStep={(d) => update("infants", d)}
              />
            </>
          )}

          <div className="h-px w-full bg-white/10" />

          <CounterRow label="Rooms" value={guests.rooms} onStep={(d) => update("rooms", d)} />
        </CardContent>
      </Card>
    </div>
  )
}

function CounterRow({
  label,
  hint,
  value,
  onStep,
}: {
  label: string
  hint?: string
  value: number
  onStep: (delta: number) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-md font-medium text-white">{label}</div>
        {hint && <div className="text-xs text-white/60">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="border-white/30 text-white hover:bg-white/10"
          aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={() => onStep(-1)}
        >
          <MinusIcon className="h-4 w-4" />
        </Button>
        <span className="w-6 text-center text-sm font-semibold" aria-live="polite">
          {value}
        </span>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="border-white/30 text-white hover:bg-white/10"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onStep(1)}
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
