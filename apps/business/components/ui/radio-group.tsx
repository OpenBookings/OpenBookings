"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { CircleIcon } from "lucide-react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

/**
 * A choice laid out as a card: the radio, a title and one line. The one
 * recipe for "pick one of these options" in the console; the whole card is
 * the label, and the selected card gets a brighter edge, never a hue.
 */
function RadioGroupCard({
  title,
  description,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <label
      data-slot="radio-group-card"
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border bg-background px-3.5 py-3 transition-colors hover:bg-accent has-[[data-state=checked]]:border-foreground/40 has-[[data-state=checked]]:bg-card has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        className
      )}
    >
      <RadioGroupItem className="mt-0.5" {...props} />
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium text-sm">{title}</span>
        {description ? <span className="text-muted-foreground text-xs">{description}</span> : null}
        {children}
      </span>
    </label>
  )
}

export { RadioGroup, RadioGroupItem, RadioGroupCard }
