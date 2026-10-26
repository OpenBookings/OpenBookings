"use client"

import * as React from "react"
import { type DateRange, type DayButton, getDefaultClassNames } from "react-day-picker"
import { Calendar, CalendarDayButton } from "@/components/ui/calendar"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CardTitle } from "../ui/card"

interface Calendar05Props {
  checkIn?: string
  checkOut?: string
  onDateChange?: (dateRange: DateRange | undefined) => void
}

const rdp = getDefaultClassNames()

const navButton = cn(
  buttonVariants({ variant: "ghost" }),
  "size-(--cell-size) p-0 select-none text-white/60 hover:bg-white/10 hover:text-white aria-disabled:opacity-30"
)

// Glass styling for the day cells. The base CalendarDayButton uses theme
// tokens, so the overrides repeat its data-* variants to win on specificity.
function GlassDayButton({
  className,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const isEndpoint =
    modifiers.range_start ||
    modifiers.range_end ||
    (modifiers.selected && !modifiers.range_middle)

  return (
    <CalendarDayButton
      modifiers={modifiers}
      className={cn(
        "relative focus-visible:ring-white/40",
        "group-data-[focused=true]/day:border-white/40 group-data-[focused=true]/day:ring-white/40",
        isEndpoint
          ? [
              "rounded-md font-medium text-black hover:bg-white hover:text-black",
              "data-[range-start=true]:rounded-md data-[range-start=true]:bg-white data-[range-start=true]:text-black",
              "data-[range-end=true]:rounded-md data-[range-end=true]:bg-white data-[range-end=true]:text-black",
              "data-[selected-single=true]:bg-white data-[selected-single=true]:text-black",
            ]
          : [
              "text-white/90 hover:bg-white/10 hover:text-white",
              "data-[range-middle=true]:bg-transparent data-[range-middle=true]:text-white data-[range-middle=true]:hover:bg-white/10",
            ],
        modifiers.disabled && "text-white/20 disabled:opacity-100",
        // Today: a small dot under the number, so it never looks selected.
        modifiers.today &&
          "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-current",
        className
      )}
      {...props}
    />
  )
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

  const today = React.useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

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
        showOutsideDays={false}
        disabled={{ before: today }}
        startMonth={today}
        className="rounded-lg border border-white/20 shadow-2xl bg-black/70 backdrop-blur-md p-4 text-white/90"
        classNames={{
          caption_label: cn("select-none text-sm font-medium text-white/90", rdp.caption_label),
          button_previous: cn(navButton, rdp.button_previous),
          button_next: cn(navButton, rdp.button_next),
          weekday: cn(
            "flex-1 select-none rounded-md text-[0.7rem] font-medium uppercase tracking-wider text-white/40",
            rdp.weekday
          ),
          // The range band sits on the cell; the white caps sit on top of it.
          range_start: cn("rounded-l-md bg-white/10", rdp.range_start),
          range_middle: cn("rounded-none bg-white/10 first:rounded-l-md last:rounded-r-md", rdp.range_middle),
          range_end: cn("rounded-r-md bg-white/10", rdp.range_end),
          today: rdp.today,
          disabled: rdp.disabled,
        }}
        components={{ DayButton: GlassDayButton }}
      />
    </div>
  )
}
