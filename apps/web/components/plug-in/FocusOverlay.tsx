// components/FocusOverlay.tsx
'use client'

import { ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function FocusOverlay({
  open,
  onClose,
  children,
  contentClassName = 'max-w-3xl px-6 sm:px-8',
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Width and padding of the content wrapper; wider panels pass their own. */
  contentClassName?: string
}) {
  // lock scroll
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // close on ESC key
  useEffect(() => {
    if (!open) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-md"
        onClick={onClose}
      />

      {/* focused content - full-width wrapper so SearchBar/GuestSelector get room to breathe */}
      <div className={`relative z-10 w-full ${contentClassName}`}>
        <div className="w-full min-w-0">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
