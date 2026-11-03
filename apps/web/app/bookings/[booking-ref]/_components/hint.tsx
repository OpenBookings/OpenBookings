'use client';

import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** The page's icon buttons: the search page's glass pill, square. */
export const GLASS_ICON_BUTTON =
  'size-9 rounded-xl border border-white/20 bg-white/10 p-0 text-white shadow-none backdrop-blur-sm hover:bg-white/15 hover:text-white disabled:opacity-60 [&_svg]:size-4';

/**
 * An icon button's name and, optionally, what it would do right now, on hover
 * and keyboard focus. The button carries the same name as its aria-label.
 */
export function Hint({ label, text, children }: { label: string; text?: string | null; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        sideOffset={6}
        className="max-w-60 rounded-lg border border-white/15 bg-black/90 px-3 py-2 text-[13px] leading-snug shadow-2xl backdrop-blur-sm"
      >
        <span className="block font-medium text-white">{label}</span>
        {text ? <span className="block text-white/65">{text}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
