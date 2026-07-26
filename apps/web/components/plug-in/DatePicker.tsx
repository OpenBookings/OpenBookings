"use client"

import * as React from "react"
import { type DateRange } from "react-day-picker"
import { Calendar } from "@/components/ui/calendar"
import { CardTitle } from "../ui/card"

interface Calendar05Props {
  checkIn?: string
  checkOut?: string
  onDateChange?: (dateRange: DateRange | undefined) => void
}

export function Calendar05({ checkIn, checkOut, onDateChange }: Calendar05Props) {
  const dateRange: DateRange | undefined = React.useMemo(() => {
    if (!checkIn && !checkOut) return undefined
    
    const from = checkIn ? new Date(checkIn + 'T00:00:00') : undefined
    const to = checkOut ? new Date(checkOut + 'T00:00:00') : undefined
    
    // Validate dates
    if (from && isNaN(from.getTime())) return undefined
    if (to && isNaN(to.getTime())) return undefined
    
    return {
      from,
      to,
    }
  }, [checkIn, checkOut])

  const [month, setMonth] = React.useState<Date>(() => {
    return dateRange?.from || new Date()
  })

  // Update month when dateRange's `from` changes to a different month/year.
  const [trackedFrom, setTrackedFrom] = React.useState(dateRange?.from)
  if (dateRange?.from?.getTime() !== trackedFrom?.getTime()) {
    setTrackedFrom(dateRange?.from)
    if (
      dateRange?.from &&
      (dateRange.from.getMonth() !== month.getMonth() ||
        dateRange.from.getFullYear() !== month.getFullYear())
    ) {
      setMonth(dateRange.from)
    }
  }

  const handleSelect = (range: DateRange | undefined) => {
    onDateChange?.(range)
  }

  const handleMonthChange = (newMonth: Date) => {
    setMonth(newMonth)
  }

  return (
    <div className="relative w-full min-w-0 max-w-lg mx-auto space-y-3">
      <CardTitle className="pl-4 text-xl font-semibold tracking-[0.16em] text-white/60 uppercase">
        Check In & Out
      </CardTitle>
    <Calendar
      mode="range"
      month={month}
      onMonthChange={handleMonthChange}
      selected={dateRange}
      onSelect={handleSelect}
      numberOfMonths={2}
      className="rounded-lg border border-white/20 shadow-2xl bg-black/70 backdrop-blur-md p-4"
    />
    </div>
  )
}
