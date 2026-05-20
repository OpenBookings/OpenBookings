'use client';

import {
  IconActivity,
  IconListCheck,
  IconSparkles,
  IconHelp,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/components/ui/sidebar';
import { Popover as PopoverPrimitive } from 'radix-ui';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { OnboardingChecklist, ONBOARDING_STEPS } from './onboarding-01';

// ─── Generic status button ────────────────────────────────────────────────────

function StatusButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className="flex items-center justify-center size-7 rounded-md transition-colors text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

// ─── Status bar ───────────────────────────────────────────────────────────────

export function StatusBar() {
  const { state } = useSidebar();
  if (state === 'collapsed') return null;

  const completedCount = ONBOARDING_STEPS.filter((s) => s.completed).length;
  const allDone = completedCount === ONBOARDING_STEPS.length;

  return (
    <TooltipProvider>
      <div className="border-t border-b border-sidebar-border px-3 py-2">
        <div className="flex items-center justify-around">

          {/* Uptime */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Uptime"
                className="relative flex items-center justify-center size-7 rounded-md transition-colors text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              >
                <IconActivity className="size-4" />
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-green-400" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Uptime — all systems operational</TooltipContent>
          </Tooltip>

          {/* Onboarding */}
          {!allDone && (
            <PopoverPrimitive.Root>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverPrimitive.Trigger asChild>
                    <button
                      aria-label="Get started"
                      className={cn(
                        'relative flex items-center justify-center size-7 rounded-md transition-colors',
                        'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60'
                      )}
                    >
                      <IconListCheck className="size-4" />
                      <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                    </button>
                  </PopoverPrimitive.Trigger>
                </TooltipTrigger>
                <TooltipContent side="top">
                  Get started — {completedCount}/{ONBOARDING_STEPS.length} done
                </TooltipContent>
              </Tooltip>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="z-50 w-72 rounded-lg border border-border bg-card p-3 shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=top]:slide-in-from-bottom-2"
                >
                  <p className="text-sm font-semibold text-foreground mb-3">Get started</p>
                  <OnboardingChecklist />
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          )}

          {/* What's new */}
          <StatusButton icon={<IconSparkles className="size-4" />} label="What's new" />

          {/* Help */}
          <StatusButton icon={<IconHelp className="size-4" />} label="Help" />

        </div>
      </div>
    </TooltipProvider>
  );
}
