"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A non-modal panel anchored bottom-right that stays open while the page
 * behind it is used — clicking the page doesn't close it, there is no
 * overlay and no focus trap. Full-screen below `md`.
 *
 * Built on Radix Dialog with `modal={false}`, so it keeps `role="dialog"`,
 * labelling via `FloatingPanelTitle`, and Esc to close. Opening is
 * controlled by the caller; pass `returnFocusRef` to send focus back to
 * whatever opened it.
 */
function FloatingPanel({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {children}
    </DialogPrimitive.Root>
  )
}

function FloatingPanelContent({
  className,
  children,
  returnFocusRef,
  initialFocusRef,
  onInteractOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  returnFocusRef?: React.RefObject<HTMLElement | null>
  initialFocusRef?: React.RefObject<HTMLElement | null>
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Content
        data-slot="floating-panel"
        // The page stays usable behind the panel: outside clicks never close it.
        onInteractOutside={(event) => {
          event.preventDefault()
          onInteractOutside?.(event)
        }}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          if (event.defaultPrevented) return
          if (initialFocusRef?.current) {
            event.preventDefault()
            initialFocusRef.current.focus()
          }
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          event.preventDefault()
          returnFocusRef?.current?.focus()
        }}
        className={cn(
          "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-sm outline-none",
          "md:inset-auto md:right-4 md:bottom-4 md:h-[min(640px,calc(100dvh-2rem))] md:w-[380px] md:rounded-lg md:border md:shadow-sm",
          "duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2",
          "motion-reduce:animate-none",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function FloatingPanelHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="floating-panel-header"
      className={cn("flex h-12 shrink-0 items-center gap-1 border-b px-2", className)}
      {...props}
    />
  )
}

function FloatingPanelTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="floating-panel-title"
      className={cn("min-w-0 flex-1 truncate px-1 text-sm font-medium", className)}
      {...props}
    />
  )
}

function FloatingPanelDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="floating-panel-description"
      className={cn("sr-only", className)}
      {...props}
    />
  )
}

function FloatingPanelClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="floating-panel-close" {...props} />
}

export {
  FloatingPanel,
  FloatingPanelClose,
  FloatingPanelContent,
  FloatingPanelDescription,
  FloatingPanelHeader,
  FloatingPanelTitle,
}
