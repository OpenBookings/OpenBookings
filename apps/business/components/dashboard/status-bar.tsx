'use client';

import {
  IconActivity,
  IconListCheck,
  IconSparkles,
  IconHelp,
  IconMessageCircle,
  IconBook,
  IconX,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { OnboardingChecklist, ONBOARDING_STEPS } from './onboarding-01';

// ─── Mock data ────────────────────────────────────────────────────────────────

type ActionItem = {
  id: string;
  time: string;
  title: string;
  description: string;
  actionHref: string;
};

const ACTION_ITEMS: ActionItem[] = [
  {
    id: 'onboarding',
    time: '',
    title: 'Complete onboarding',
    description: 'Finish setting up your property to start receiving bookings.',
    actionHref: '#',
  },
  {
    id: 'message-anna',
    time: '2h ago',
    title: 'Anna K.',
    description: 'Hi, is early check-in possible on the 24th? We land at…',
    actionHref: '#',
  },
  {
    id: 'payout',
    time: '5h ago',
    title: 'Approve payout',
    description: '€1,240.50 is ready to be paid out to your bank account.',
    actionHref: '#',
  },
  {
    id: 'message-mark',
    time: 'Yesterday',
    title: 'Mark V.',
    description: 'Could we add a baby cot to the Deluxe Double room?',
    actionHref: '#',
  },
];

type WhatsNewItem = {
  id: string;
  date: string;
  title: string;
  excerpt: string;
  href: string;
};

const WHATS_NEW_ITEMS: WhatsNewItem[] = [
  {
    id: 'commission-update',
    date: 'Jul 10',
    title: 'Commission rate update',
    excerpt:
      'From August 1st the platform commission drops from 12% to 10% for all direct bookings.',
    href: '#',
  },
  {
    id: 'analytics-views',
    date: 'Jul 2',
    title: 'A new way to view analytics',
    excerpt:
      'Compare booking sources side-by-side and track conversion per channel in the new Analytics overview.',
    href: '#',
  },
  {
    id: 'adyen-transition',
    date: 'Jun 24',
    title: 'Stripe to Adyen transition',
    excerpt:
      'We are migrating payment processing to Adyen. No action needed — payouts continue as usual.',
    href: '#',
  },
];

// ─── Panels ───────────────────────────────────────────────────────────────────

function PanelShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-2 mb-2 rounded-xl border border-border bg-popover shadow-lg shadow-black/10 dark:shadow-black/40 ring-1 ring-black/5 dark:ring-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="flex items-center justify-center size-6 rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-sidebar-accent/60"
        >
          <IconX className="size-3.5" />
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">{children}</div>
    </div>
  );
}

function ItemCard({
  title,
  time,
  body,
  onClick,
  onDismiss,
  children,
}: {
  title: string;
  time: string;
  body: string;
  onClick?: () => void;
  onDismiss?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <article className="rounded-lg bg-muted/50 transition-colors hover:bg-muted">
      <div
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => {
          if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn('flex gap-3 p-3', onClick && 'cursor-pointer')}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="flex-1 truncate text-sm font-medium text-foreground">{title}</p>
            <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span>
            {onDismiss && (
              <button
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
                className="shrink-0 text-muted-foreground/50 transition-colors hover:text-red-500"
              >
                <IconTrash className="size-3.5" />
              </button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{body}</p>
        </div>
      </div>
      {children}
    </article>
  );
}

function ActionListPanel() {
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  const items = ACTION_ITEMS.filter((item) => !dismissedIds.includes(item.id));

  if (items.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        All caught up — nothing needs your attention.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const isOnboarding = item.id === 'onboarding';
        return (
          <ItemCard
            key={item.id}
            title={item.title}
            time={item.time}
            body={item.description}
            onClick={
              isOnboarding ? () => setChecklistOpen((open) => !open) : undefined
            }
            onDismiss={() =>
              setDismissedIds((ids) => [...ids, item.id])
            }
          >
            {isOnboarding && checklistOpen && (
              <div className="px-3 pb-3">
                <OnboardingChecklist />
              </div>
            )}
          </ItemCard>
        );
      })}
    </div>
  );
}

function WhatsNewPanel() {
  return (
    <div className="space-y-1.5">
      {WHATS_NEW_ITEMS.map((item) => (
        <ItemCard
          key={item.id}
          title={item.title}
          time={item.date}
          body={item.excerpt}
        />
      ))}
    </div>
  );
}

function HelpPanel() {
  return (
    <div className="space-y-1">
      {HELP_LINKS.map((link) => {
        const content = (
          <>
            <span className="shrink-0 text-muted-foreground">{link.icon}</span>
            <span className="flex flex-col">
              <span className="text-sm text-foreground">{link.title}</span>
              <span className="text-xs text-muted-foreground">{link.description}</span>
            </span>
          </>
        );

        return (
          <a
            key={link.title}
            href={link.href}
            target={link.href.startsWith('http') ? '_blank' : undefined}
            rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
            className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-muted"
          >
            {content}
          </a>
        );
      })}
    </div>
  );
}

// ─── Generic status button ────────────────────────────────────────────────────

function StatusButton({
  icon,
  label,
  active,
  onClick,
  badge,
  tooltipSide = 'top',
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: React.ReactNode;
  tooltipSide?: 'top' | 'right';
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className={cn(
            'relative flex items-center justify-center size-7 rounded-md transition-colors',
            active
              ? 'text-sidebar-foreground bg-sidebar-accent'
              : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60'
          )}
        >
          {icon}
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
}

// ─── Help ─────────────────────────────────────────────────────────────────────

type HelpLink = {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
};

const HELP_LINKS: HelpLink[] = [
  {
    icon: <IconBook className="size-4" />,
    title: 'Documentation',
    description: 'Guides / API reference',
    href: 'https://docs.openbookings.co',
  },
];

// ─── Status bar ───────────────────────────────────────────────────────────────

type StatusIncident = {
  name: string;
  status: string;
  current_worst_impact:
    | 'full_outage'
    | 'partial_outage'
    | 'degraded_performance'
    | (string & {});
};

type StatusSummary = {
  ongoing_incidents: StatusIncident[];
  in_progress_maintenances: unknown[];
  scheduled_maintenances: unknown[];
};

type SystemStatus = {
  level: 'operational' | 'degraded' | 'partial-outage' | 'full-outage' | 'maintenance';
  label: string;
};

const STATUS_DOT_COLORS: Record<SystemStatus['level'], string> = {
  operational: 'bg-green-400',
  maintenance: 'bg-blue-400',
  degraded: 'bg-amber-400',
  'partial-outage': 'bg-orange-400',
  'full-outage': 'bg-red-500',
};

function summarizeStatus(summary: StatusSummary): SystemStatus {
  const incidents = summary.ongoing_incidents;

  if (incidents.length > 0) {
    const impacts = incidents.map((incident) => incident.current_worst_impact);
    const names = incidents.map((incident) => incident.name).join(', ');

    if (impacts.includes('full_outage')) {
      return { level: 'full-outage', label: `Outage — ${names}` };
    }
    if (impacts.includes('partial_outage')) {
      return { level: 'partial-outage', label: `Partial outage — ${names}` };
    }
    return { level: 'degraded', label: `Degraded performance — ${names}` };
  }

  if (summary.in_progress_maintenances.length > 0) {
    return { level: 'maintenance', label: 'Maintenance in progress' };
  }
  if (summary.scheduled_maintenances.length > 0) {
    return { level: 'maintenance', label: 'Maintenance scheduled' };
  }

  return { level: 'operational', label: 'All systems operational' };
}

const STATUS_CACHE_KEY = 'system-status-summary';
const STATUS_CACHE_TTL_MS = 15 * 60 * 1000;

function readCachedStatus(): SystemStatus | null {
  try {
    const raw = localStorage.getItem(STATUS_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { fetchedAt: number; status: SystemStatus };
    if (Date.now() - cached.fetchedAt > STATUS_CACHE_TTL_MS) return null;
    return cached.status;
  } catch {
    return null;
  }
}

function writeCachedStatus(status: SystemStatus) {
  try {
    localStorage.setItem(
      STATUS_CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), status })
    );
  } catch {
    // Storage full or unavailable — skip caching.
  }
}

function useSystemStatus(): SystemStatus {
  const [status, setStatus] = useState<SystemStatus>({
    level: 'operational',
    label: 'Nothing here...',
  });

  useEffect(() => {
    const applyCached = () => {
      const cached = readCachedStatus();
      if (cached) setStatus(cached);
      return !!cached;
    };
    if (applyCached()) return;

    const controller = new AbortController();

    fetch('https://status.openbookings.co/api/v1/summary', {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<StatusSummary>) : null))
      .then((summary) => {
        if (!summary) return;
        const next = summarizeStatus(summary);
        writeCachedStatus(next);
        setStatus(next);
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);

  return status;
}

type Panel = 'actions' | 'whats-new' | 'help';

export function StatusBar() {
  const { state, setOpen } = useSidebar();
  const isCollapsed = state === 'collapsed';
  const [activePanel, setActivePanel] = useState<Panel | null>(null);
  const systemStatus = useSystemStatus();

  const completedCount = ONBOARDING_STEPS.filter((s) => s.completed).length;
  const tooltipSide = isCollapsed ? 'right' : 'top';

  function togglePanel(panel: Panel) {
    if (isCollapsed) {
      // Panels don't fit in the icon rail — expand first, then show the panel.
      setOpen(true);
      setActivePanel(panel);
      return;
    }
    setActivePanel((current) => (current === panel ? null : panel));
  }

  return (
    <TooltipProvider>
      {!isCollapsed && activePanel === 'actions' && (
        <PanelShell title="Needs attention" onClose={() => setActivePanel(null)}>
          <ActionListPanel />
        </PanelShell>
      )}
      {!isCollapsed && activePanel === 'whats-new' && (
        <PanelShell title="What's new" onClose={() => setActivePanel(null)}>
          <WhatsNewPanel />
        </PanelShell>
      )}
      {!isCollapsed && activePanel === 'help' && (
        <PanelShell title="Help" onClose={() => setActivePanel(null)}>
          <HelpPanel />
        </PanelShell>
      )}

      <div
        className={cn(
          'border-t border-b border-sidebar-border',
          isCollapsed ? 'px-0 py-2' : 'px-3 py-2'
        )}
      >
        <div
          className={cn(
            'flex items-center justify-around',
            isCollapsed && 'flex-col gap-1'
          )}
        >

          {/* Uptime */}
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://status.openbookings.co"
                target="_blank"
                rel="noreferrer"
                aria-label="Uptime"
                className="relative flex items-center justify-center size-7 rounded-md transition-colors text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              >
                <IconActivity className="size-4" />
                <span
                  className={cn(
                    'absolute top-1 right-1 size-1.5 rounded-full',
                    STATUS_DOT_COLORS[systemStatus.level]
                  )}
                />
              </a>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>{systemStatus.label}</TooltipContent>
          </Tooltip>

          {/* Action list */}
          <StatusButton
            icon={<IconListCheck className="size-4" />}
            label={`Needs attention — ${ACTION_ITEMS.length} items, onboarding ${completedCount}/${ONBOARDING_STEPS.length}`}
            active={!isCollapsed && activePanel === 'actions'}
            onClick={() => togglePanel('actions')}
            badge={<span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />}
            tooltipSide={tooltipSide}
          />

          {/* What's new */}
          <StatusButton
            icon={<IconSparkles className="size-4" />}
            label="What's new"
            active={!isCollapsed && activePanel === 'whats-new'}
            onClick={() => togglePanel('whats-new')}
            tooltipSide={tooltipSide}
          />

          {/* Help */}
          <StatusButton
            icon={<IconHelp className="size-4" />}
            label="Help"
            active={!isCollapsed && activePanel === 'help'}
            onClick={() => togglePanel('help')}
            tooltipSide={tooltipSide}
          />

        </div>
      </div>
    </TooltipProvider>
  );
}
